    new_code_raw = ''.join(secrets.choice(string.ascii_uppercase + string.ascii_lowercase + string.digits) for _ in range(5))
    new_code_hash = hashlib.sha256(new_code_raw.encode("utf-8")).hexdigest()
    supabase.table("invitations").insert({
        "id": str(new_user_id) + "_inv",
        "code_hash": new_code_hash,
        "inviter_id": new_user_id,
        "expires_at": (datetime.now(timezone.utc) + __import__('datetime').timedelta(days=30)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"ok": True, "user_id": new_user_id, "inviter_id": inv["inviter_id"], "my_invite_code": new_code_raw}
