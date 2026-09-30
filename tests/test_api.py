from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from api import index as api

USER = str(uuid4())
OTHER = str(uuid4())


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://database.test')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret-never-return')
    monkeypatch.setenv('GEMINI_API_KEY', 'test-ai-secret')
    monkeypatch.setenv('GEMINI_MODEL', 'test-model')
    api.app.dependency_overrides.clear()
    with TestClient(api.app) as client:
        yield client
    api.app.dependency_overrides.clear()


def mock_network(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


def authenticated():
    api.app.dependency_overrides[api.member] = lambda: USER


@pytest.mark.parametrize('path', ['/api/state', '/api/invitations', '/api/invitation-memo', '/api/invitation-delete', '/api/profile', '/api/profile-photo-delete', '/api/profile-approval', '/api/contact', '/api/matches', '/api/match-response', '/api/introduction'])
def test_all_private_routes_require_bearer(client, path):
    response = client.get(path) if path == '/api/state' else client.post(path, json={})
    assert response.status_code == 401
    assert response.json()['error']['code'] == 'UNAUTHORIZED'
    assert response.headers['cache-control'] == 'no-store'


def test_invalid_token_is_checked_upstream(client, monkeypatch):
    mock_network(monkeypatch, lambda r: httpx.Response(401, json={'message': 'expired'}))
    assert client.get('/api/state', headers={'Authorization': 'Bearer invalid'}).status_code == 401


def test_auth_account_without_membership_is_rejected(client, monkeypatch):
    mock_network(monkeypatch, lambda r: httpx.Response(200, json={'id': USER} if r.url.path == '/auth/v1/user' else []))
    assert client.get('/api/state', headers={'Authorization': 'Bearer valid'}).status_code == 403


def test_state_does_not_leak_graph_or_author(client, monkeypatch):
    authenticated()
    async def action(*_):
        return {'graph': [{'id': USER, 'invited_by': OTHER}, {'id': OTHER, 'invited_by': None}],
            'profiles': [{'id': str(uuid4()), 'owner_id': OTHER, 'nickname': '친구', 'age_band': '31세',
                'birth_year_month': '1995-06-01', 'hometown': '부산', 'region': '서울', 'hobbies': [],
                'job': '마케터', 'height_cm': 170, 'religion': '', 'mbti': 'ENFP', 'introduction': '소개',
                'author_id': 'private', 'invitation_id': 'private'}]}
    monkeypatch.setattr(api, 'action', action)
    async def invitations(*_): return []
    monkeypatch.setattr(api, 'invitation_action', invitations)
    async def photos(*_): return []
    monkeypatch.setattr(api, 'profile_photo_action', photos)
    data = client.get('/api/state').json()
    assert 'graph' not in data
    assert data['profiles'][0]['distance'] == 1
    assert 'author_id' not in data['profiles'][0]
    assert 'invitation_id' not in data['profiles'][0]


def test_distance_cycles_and_disconnected_groups():
    result = api.distances([{'id':'a','invited_by':'b'},{'id':'b','invited_by':'c'},{'id':'c','invited_by':'a'},
                           {'id':'x','invited_by':'y'}], 'a')
    assert result == {'a': 0, 'b': 1, 'c': 1}


@pytest.mark.parametrize('notes', ['', '짧은 글', 'a' * 1001, ' ' * 30])
def test_ai_invalid_input_never_calls_provider(client, monkeypatch, notes):
    authenticated()
    mock_network(monkeypatch, lambda r: pytest.fail('Must not call provider'))
    assert client.post('/api/introduction', json={'notes':notes}).status_code == 400


def test_client_cannot_impersonate_author(client):
    authenticated()
    response = client.post('/api/profile', json={'author_id': OTHER, 'nickname':'친구'})
    assert response.status_code == 400
    assert client.post('/api/save_intro', json={'author_id': OTHER}).status_code == 404


def ai_network(monkeypatch, outcome):
    authenticated()
    async def action(*_): return {'ok':True}
    monkeypatch.setattr(api, 'action', action)
    mock_network(monkeypatch, outcome)


def test_ai_success_and_private_key_boundaries(client, monkeypatch):
    import json
    def handler(request):
        payload = json.loads(request.content)
        assert payload['generationConfig']['maxOutputTokens'] == 400
        assert payload['contents'][0]['parts'][0]['text'].startswith('산책과')
        assert payload['systemInstruction']['parts'][0]['text']
        assert request.headers['x-goog-api-key'] == 'test-ai-secret'
        assert request.url.path.endswith('/models/test-model:generateContent')
        return httpx.Response(200, json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'차분한 친구예요.'}]}}]})
    ai_network(monkeypatch, handler)
    response = client.post('/api/introduction', json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'})
    assert response.json() == {'introduction':'차분한 친구예요.'}
    assert 'secret' not in response.text


@pytest.mark.parametrize('status, expected', [(429,429),(401,502),(500,502)])
def test_ai_provider_failures(client, monkeypatch, status, expected):
    ai_network(monkeypatch, lambda r: httpx.Response(status, json={'error':'secret upstream diagnostics'}))
    response = client.post('/api/introduction', json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'})
    assert response.status_code == expected
    assert 'secret' not in response.text


def test_ai_timeout(client, monkeypatch):
    def timeout(request): raise httpx.ReadTimeout('secret diagnostics', request=request)
    ai_network(monkeypatch, timeout)
    assert client.post('/api/introduction', json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'}).status_code == 504


@pytest.mark.parametrize('body', [
    {'candidates':[]},
    {'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':'미완성'}]}}]},
    {'candidates':[{'finishReason':'SAFETY','content':{'parts':[]}}]},
])
def test_ai_does_not_claim_empty_or_incomplete_success(client, monkeypatch, body):
    ai_network(monkeypatch, lambda r: httpx.Response(200,json=body))
    assert client.post('/api/introduction',json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'}).status_code == 502


def test_missing_ai_configuration(client, monkeypatch):
    authenticated()
    monkeypatch.delenv('GEMINI_API_KEY')
    assert client.post('/api/introduction', json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'}).status_code == 503


def test_secrets_and_source_not_served(client):
    for path in ['/.env','/.git/config','/requirements.txt','/supabase/migrations/001_initial_schema.sql','/api/index.py']:
        assert client.get(path).status_code == 404
    assert client.get('/').status_code == 200


def test_oversized_body_rejected(client):
    assert client.post('/api/verify_invite', content='a'*17000).status_code == 413


def test_signup_compensates_definitive_conflict(client, monkeypatch):
    calls = []
    async def upstream(method, path, **_):
        calls.append((method,path))
        if 'invitations' in path: return [{'id':'invite'}]
        if method == 'POST' and path == '/auth/v1/admin/users': return {'id':USER}
        if 'finish_join' in path: api.fail(400,'INVITE_INVALID','used')
    monkeypatch.setattr(api,'supabase',upstream)
    result = client.post('/api/verify_invite',json={'email':'a@example.com','password':'strong-password',
        'display_name':'친구','invitation_code':'12345678','adult_confirmed':True})
    assert result.status_code == 400
    assert ('DELETE','/auth/v1/admin/users/'+USER) in calls


def test_signup_timeout_does_not_delete_potentially_committed_user(client, monkeypatch):
    calls = []
    async def upstream(method,path,**_):
        calls.append(method)
        if 'invitations' in path: return [{'id':'invite'}]
        if path == '/auth/v1/admin/users': return {'id':USER}
        api.fail(504,'TIMEOUT','slow')
    monkeypatch.setattr(api,'supabase',upstream)
    assert client.post('/api/verify_invite',json={'email':'a@example.com','password':'strong-password',
        'display_name':'친구','invitation_code':'12345678','adult_confirmed':True}).status_code == 504
    assert 'DELETE' not in calls


def test_short_invite_contains_both_letters_and_digits():
    import re
    for _ in range(100):
        code = api.make_invite_code()
        assert re.fullmatch(r'[A-Z0-9]{5}', code)
        assert any(c.isalpha() for c in code)
        assert any(c.isdigit() for c in code)


def test_invite_retries_unique_collision(client, monkeypatch):
    authenticated()
    codes = iter(['AB123', 'CD456'])
    monkeypatch.setattr(api, 'make_invite_code', lambda: next(codes))
    calls = []
    async def invitation_action(user, name, data):
        calls.append(data)
        if len(calls) == 1:
            api.fail(409, 'DUPLICATE', 'collision')
        return {'id': OTHER}
    monkeypatch.setattr(api, 'invitation_action', invitation_action)
    response = client.post('/api/invitations', json={'memo':'회사 친구'})
    assert response.status_code == 200
    assert response.json()['code'] == 'CD456'
    assert len(calls) == 2
    assert calls[-1]['memo'] == '회사 친구'


def test_invitation_memo_is_limited_to_ten_characters(client):
    authenticated()
    response = client.post('/api/invitations', json={'memo':'12345678901'})
    assert response.status_code == 400
    assert response.json()['error']['code'] == 'INVALID_INPUT'


def profile_body(**updates):
    body = {'invitation_id': OTHER, 'nickname': '박세빈', 'birth_year_month': '1995-06',
        'hometown': '', 'region': '서울 마포구', 'hobbies': ['산책'], 'job': '마케터',
        'height_cm': 170, 'religion': '', 'mbti': 'ENFP', 'introduction': '차분하고 다정한 사람입니다.'}
    body.update(updates)
    return body


def test_expanded_profile_payload_and_limits(client, monkeypatch):
    authenticated()
    calls = []
    async def rpc(name, payload): calls.append((name, payload)); return {'id': OTHER}
    monkeypatch.setattr(api, 'rpc', rpc)
    response = client.post('/api/profile', json=profile_body())
    assert response.status_code == 200
    assert calls[0][0] == 'profile_action'
    saved = calls[0][1]['p_data']
    assert saved['birth_year_month'] == '1995-06-01'
    assert saved['age_band'].endswith('세')
    assert client.post('/api/profile', json=profile_body(introduction='가' * 201)).status_code == 400
    assert client.post('/api/profile', json=profile_body(height_cm=99)).status_code == 400
    assert client.post('/api/profile', json=profile_body(mbti='ABCD')).status_code == 400


def test_profile_photo_upload_validates_and_registers(client, monkeypatch):
    authenticated()
    actions, storage = [], []
    async def photo_action(user, name, data=None):
        actions.append((name, data))
        return {'ok': True} if name == 'authorize' else {'id': OTHER, 'position': 0}
    async def storage_call(method, path, **kwargs):
        storage.append((method, path, kwargs)); return {'ok': True}
    monkeypatch.setattr(api, 'profile_photo_action', photo_action)
    monkeypatch.setattr(api, 'storage_request', storage_call)
    response = client.post('/api/profile-photo', data={'profile_id': OTHER},
        files={'file': ('photo.jpg', b'\xff\xd8\xffsafe-image', 'image/jpeg')})
    assert response.status_code == 200
    assert [name for name, _ in actions] == ['authorize', 'register']
    assert storage[0][0] == 'POST'
    assert storage[0][2]['content_type'] == 'image/jpeg'
    invalid = client.post('/api/profile-photo', data={'profile_id': OTHER},
        files={'file': ('fake.jpg', b'not-an-image', 'image/jpeg')})
    assert invalid.status_code == 400
    assert invalid.json()['error']['code'] == 'INVALID_IMAGE'


def test_ai_rejects_result_over_profile_limit(client, monkeypatch):
    ai_network(monkeypatch, lambda r: httpx.Response(200, json={'candidates':[
        {'finishReason':'STOP','content':{'parts':[{'text':'가' * 201}]}}]}))
    assert client.post('/api/introduction', json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'}).status_code == 502


@pytest.mark.parametrize('code,expected', [('ab123','AB123'), ('Legacy_MixedCase-123','Legacy_MixedCase-123')])
def test_invite_signup_short_and_legacy_hashes(client, monkeypatch, code, expected):
    import hashlib
    hashes = []
    async def upstream(method, path, **kwargs):
        if 'invitations' in path:
            hashes.append(kwargs['params']['code_hash'])
            return [{'id': OTHER}]
        if path == '/auth/v1/admin/users': return {'id': USER}
        return {'ok': True}
    monkeypatch.setattr(api, 'supabase', upstream)
    response = client.post('/api/verify_invite', json={'email': 'a@example.com', 'password': 'strong-password',
        'display_name': '친구', 'invitation_code': code, 'adult_confirmed': True})
    assert response.status_code == 200
    assert hashes == ['eq.' + hashlib.sha256(expected.encode()).hexdigest()]
