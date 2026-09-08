from fastapi import FastAPI, HTTPException, Request
from supabase import create_client, Client
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

@app.post("/api/save_intro")
async def save_intro(request: Request):
    body = await request.json()
    author_id = body.get("author_id")
    introduction = body.get("introduction", "").strip()
    if not author_id or not introduction:
        raise HTTPException(status_code=400, detail="작성자 ID와 소개글이 필요합니다.")
    supabase.table("profiles").insert({
        "author_id": author_id,
        "nickname": "임시",
        "introduction": introduction,
        "status": "draft",
        "created_at": "now()"
    }).execute()
    return {"ok": True, "message": "소개글이 저장되었습니다."}
