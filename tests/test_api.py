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
    monkeypatch.setenv('OPENAI_API_KEY', 'test-ai-secret')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    api.app.dependency_overrides.clear()
    with TestClient(api.app) as client:
        yield client
    api.app.dependency_overrides.clear()


def mock_network(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


def authenticated():
    api.app.dependency_overrides[api.member] = lambda: USER


@pytest.mark.parametrize('path', ['/api/state', '/api/invitations', '/api/profile', '/api/profile-approval', '/api/contact', '/api/matches', '/api/match-response', '/api/introduction'])
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
            'profiles': [{'id': str(uuid4()), 'owner_id': OTHER, 'nickname': '친구', 'age_band': '20대', 'region': '서울',
                'hobbies': [], 'introduction': '소개', 'author_id': 'private', 'invitation_id': 'private'}]}
    monkeypatch.setattr(api, 'action', action)
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
        assert payload['store'] is False
        assert payload['max_output_tokens'] == 800
        assert request.headers['authorization'] == 'Bearer test-ai-secret'
        return httpx.Response(200, json={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'차분한 친구예요.'}]}]})
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


@pytest.mark.parametrize('body', [{'status':'incomplete','output':[]}, {'status':'completed','output':[]}, {'status':'completed','output':[{'type':'message','content':[{'type':'refusal','refusal':'no'}]}]}])
def test_ai_does_not_claim_empty_or_incomplete_success(client, monkeypatch, body):
    ai_network(monkeypatch, lambda r: httpx.Response(200,json=body))
    assert client.post('/api/introduction',json={'notes':'산책과 독립서점을 좋아하고 약속을 잘 지키는 친구입니다.'}).status_code == 502


def test_missing_ai_configuration(client, monkeypatch):
    authenticated()
    monkeypatch.delenv('OPENAI_API_KEY')
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
