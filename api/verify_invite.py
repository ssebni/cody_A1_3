from fastapi import FastAPI, HTTPException, Request
from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()
import hashlib

app = FastAPI()

# Supabase 클라이언트 (service_role 키 사용)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


@app.post("/api/verify_invite")
async def verify_invite(request: Request):
    """
    초대 코드 검증 후, 유효하면 회원가입(SignUp)까지 한 번에 처리.
    요청 바디: { "email": "...", "password": "...", "invitation_code": "..." }
    """
    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    invitation_code = body.get("invitation_code", "").strip()

    if not (email and password and invitation_code):
        raise HTTPException(status_code=400, detail="이메일, 비밀번호, 초대 코드를 모두 입력하세요.")

    # 1) 초대 코드 직접 비교 (5자리 등)
    code_hash = invitation_code

    # 2) invitations 테이블에서 조회
    inv_resp = supabase.table("invitations").select("id, inviter_id, expires_at, used_by").eq("code_hash", code_hash).execute()
    if not inv_resp.data:
        raise HTTPException(status_code=404, detail="초대 코드가 유효하지 않습니다.")
    inv = inv_resp.data[0]

    # 3) 만료/사용 여부 확인
    from datetime import datetime, timezone
    if datetime.fromisoformat(inv["expires_at"].replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="초대 코드가 만료되었습니다.")
    if inv["used_by"] is not None:
        raise HTTPException(status_code=400, detail="이미 사용된 초대 코드입니다.")

    # 4) Supabase Auth 회원가입
    auth_resp = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,  # 시제품이므로 바로 확인됨 처리
    })
    if auth_resp.user is None:
        raise HTTPException(status_code=400, detail="회원가입에 실패했습니다. 이메일 중복 여부를 확인하세요.")

    new_user_id = auth_resp.user.id

    # 5) members 레코드 생성 + 초대 코드 소진
    # 트랜잭션 대신 순차 실행 (시제품 수준)
    supabase.table("members").insert({
        "id": new_user_id,
        "display_name": email.split("@")[0][:40],
        "invited_by": inv["inviter_id"],
        "status": "active"
    }).execute()

    supabase.table("invitations").update({
        "used_by": new_user_id,
        "used_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", inv["id"]).execute()

    # 6) 새 사용자의 고유 초대 코드 자동 발급 (n촌 구조)
    import secrets, string
    new_code = ''.join(secrets.choice(string.ascii_uppercase + string.ascii_lowercase + string.digits) for _ in range(5))
    supabase.table("invitations").insert({
        "id": str(new_user_id) + "_inv",
        "code_hash": new_code,
        "inviter_id": new_user_id,
        "expires_at": (datetime.now(timezone.utc) + __import__('datetime').timedelta(days=30)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"ok": True, "user_id": new_user_id, "inviter_id": inv["inviter_id"], "my_invite_code": new_code}