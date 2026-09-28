from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
import string

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from supabase import create_client

load_dotenv()

app = FastAPI()


def get_supabase():
    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise HTTPException(status_code=500, detail="Supabase server configuration is missing.")
    return create_client(url, service_role_key)


def get_created_user_id(response):
    user = getattr(response, "user", None)
    if user and getattr(user, "id", None):
        return str(user.id)

    if isinstance(response, dict):
        user_data = response.get("user") or response.get("data", {}).get("user")
        if user_data and user_data.get("id"):
            return str(user_data["id"])

    data = getattr(response, "data", None)
    if data:
        user_data = getattr(data, "user", None)
        if user_data and getattr(user_data, "id", None):
            return str(user_data.id)
        if isinstance(data, dict) and data.get("user", {}).get("id"):
            return str(data["user"]["id"])

    raise HTTPException(status_code=502, detail="Created user id was not returned.")


def make_invite_code(length=8):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def hash_code(code):
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


@app.post("/api/verify_invite")
async def verify_invite(request: Request):
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    invitation_code = str(body.get("invitation_code", "")).strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="이메일을 확인해 주세요.")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="비밀번호는 6자 이상이어야 합니다.")
    if not invitation_code:
        raise HTTPException(status_code=400, detail="초대 코드를 입력해 주세요.")

    supabase = get_supabase()
    now = datetime.now(timezone.utc)

    invite_result = (
        supabase.table("invitations")
        .select("id, inviter_id, used_by, expires_at")
        .eq("code_hash", hash_code(invitation_code))
        .is_("used_by", "null")
        .gt("expires_at", now.isoformat())
        .limit(1)
        .execute()
    )
    invites = invite_result.data or []
    if not invites:
        raise HTTPException(status_code=400, detail="초대 코드가 유효하지 않거나 이미 사용되었습니다.")

    invite = invites[0]

    try:
        auth_response = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail="계정을 만들 수 없습니다. 이미 가입된 이메일인지 확인해 주세요.") from exc

    new_user_id = get_created_user_id(auth_response)
    display_name = email.split("@", 1)[0][:40] or "새 회원"

    try:
        supabase.table("members").insert({
            "id": new_user_id,
            "display_name": display_name,
            "invited_by": invite["inviter_id"],
            "status": "active",
            "created_at": now.isoformat(),
        }).execute()

        supabase.table("invitations").update({
            "used_by": new_user_id,
            "used_at": now.isoformat(),
        }).eq("id", invite["id"]).is_("used_by", "null").execute()

        new_code_raw = make_invite_code()
        supabase.table("invitations").insert({
            "code_hash": hash_code(new_code_raw),
            "inviter_id": new_user_id,
            "expires_at": (now + timedelta(days=30)).isoformat(),
            "created_at": now.isoformat(),
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="회원 정보를 저장하지 못했습니다.") from exc

    return {
        "ok": True,
        "user_id": new_user_id,
        "inviter_id": invite["inviter_id"],
        "my_invite_code": new_code_raw,
    }
