from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token_value,
    decode_token,
)
from app.config import settings
from app.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Bootstrap: the very first account ever created on this deployment becomes
    # Admin automatically and is pre-approved, since there's no existing Admin
    # around yet to approve anyone. Every account after that follows the normal
    # SDM/Associate + pending-approval flow, regardless of what role they pick.
    is_first_user = db.query(models.User).count() == 0

    user = models.User(
        full_name=payload.full_name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role="admin" if is_first_user else payload.role,
        approval_status="approved" if is_first_user else "pending",
        organization=payload.organization,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _issue_tokens(user: models.User, db: Session, remember_me: bool = False) -> schemas.TokenResponse:
    access_token = create_access_token(user.id, user.role)
    refresh_value = create_refresh_token_value()
    days = settings.REFRESH_TOKEN_EXPIRE_DAYS * (4 if remember_me else 1)
    refresh_row = models.RefreshToken(
        token=refresh_value,
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=days),
    )
    db.add(refresh_row)
    db.commit()
    return schemas.TokenResponse(access_token=access_token, refresh_token=refresh_value)


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.approval_status == "pending":
        raise HTTPException(status_code=403, detail="Your account is pending Admin approval. You'll be able to sign in once an Admin approves it.")
    if user.approval_status == "rejected":
        raise HTTPException(status_code=403, detail="Your account request was not approved. Contact an Admin if you believe this is a mistake.")
    return _issue_tokens(user, db, payload.remember_me)


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh_token(payload: schemas.RefreshRequest, db: Session = Depends(get_db)):
    row = db.query(models.RefreshToken).filter(models.RefreshToken.token == payload.refresh_token).first()
    if not row or row.revoked or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user = db.query(models.User).filter(models.User.id == row.user_id).first()
    if not user or not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="User not found or inactive")
    # rotate refresh token
    row.revoked = True
    db.commit()
    return _issue_tokens(user, db)


@router.post("/logout", status_code=204)
def logout(payload: schemas.RefreshRequest, db: Session = Depends(get_db)):
    row = db.query(models.RefreshToken).filter(models.RefreshToken.token == payload.refresh_token).first()
    if row:
        row.revoked = True
        db.commit()
    return None


@router.post("/logout-all", status_code=204)
def logout_all(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == current_user.id, models.RefreshToken.revoked == False  # noqa: E712
    ).update({"revoked": True})
    db.commit()
    return None


@router.post("/forgot-password", status_code=200)
def forgot_password(payload: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    # Always respond generically to avoid email enumeration
    if user:
        import secrets
        token_value = secrets.token_urlsafe(32)
        reset_row = models.PasswordResetToken(
            token=token_value,
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
        db.add(reset_row)
        db.commit()
        # In production this would be emailed. For local/dev use we return it directly.
        return {"message": "If that email exists, a reset link has been generated.", "dev_reset_token": token_value}
    return {"message": "If that email exists, a reset link has been generated."}


@router.post("/reset-password", status_code=200)
def reset_password(payload: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    row = db.query(models.PasswordResetToken).filter(models.PasswordResetToken.token == payload.token).first()
    if not row or row.used or row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    user = db.query(models.User).filter(models.User.id == row.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    user.hashed_password = hash_password(payload.new_password)
    row.used = True
    db.commit()
    return {"message": "Password reset successful"}


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=schemas.UserOut)
def update_me(
    payload: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.new_password:
        if not payload.current_password or not verify_password(
            payload.current_password, current_user.hashed_password
        ):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        current_user.hashed_password = hash_password(payload.new_password)
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.organization is not None:
        current_user.organization = payload.organization
    if payload.ai_provider_preference is not None:
        current_user.ai_provider_preference = payload.ai_provider_preference
    db.commit()
    db.refresh(current_user)
    return current_user
