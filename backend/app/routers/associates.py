from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_uploader

router = APIRouter(prefix="/associates", tags=["associates"])

VALID_REQUEST_TYPES = ("leave", "wfh")
VALID_STATUSES = ("pending", "approved", "rejected")


def _parse_date(value: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be an ISO date (YYYY-MM-DD)")


def _profile_for(db: Session, user_id: str) -> models.AssociateProfile | None:
    return db.query(models.AssociateProfile).filter(models.AssociateProfile.user_id == user_id).first()


def find_leave_conflict(
    db: Session, team_area: str, date_from: datetime, date_to: datetime, exclude_request_id: str | None = None
):
    """The one rule that actually prevents business impact: within a single
    team_area, only one associate may have an APPROVED Leave request
    covering any given day. Two people from the same area both being out
    at once means the area's tickets have no one to fall back on - so the
    second overlapping Leave approval is refused. WFH is deliberately not
    checked here (see LeaveRequest docstring) - working from home doesn't
    remove someone from ticket coverage."""
    q = (
        db.query(models.LeaveRequest)
        .join(models.AssociateProfile, models.LeaveRequest.associate_user_id == models.AssociateProfile.user_id)
        .filter(
            models.AssociateProfile.team_area == team_area,
            models.LeaveRequest.request_type == "leave",
            models.LeaveRequest.status == "approved",
            models.LeaveRequest.date_from <= date_to,
            models.LeaveRequest.date_to >= date_from,
        )
    )
    if exclude_request_id:
        q = q.filter(models.LeaveRequest.id != exclude_request_id)
    return q.first()


@router.get("")
async def list_associates(
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Every associate account with their assigned team_area (if set) and
    whether they're currently on approved Leave or WFH today - the roster
    view an SDM assigns backup areas from."""
    associates = db.query(models.User).filter(models.User.role == "associate").order_by(models.User.full_name).all()
    profiles = {p.user_id: p.team_area for p in db.query(models.AssociateProfile).all()}
    today = datetime.utcnow()
    today_requests = (
        db.query(models.LeaveRequest)
        .filter(
            models.LeaveRequest.status == "approved",
            models.LeaveRequest.date_from <= today,
            models.LeaveRequest.date_to >= today,
        )
        .all()
    )
    today_by_user = {}
    for r in today_requests:
        today_by_user[r.associate_user_id] = r.request_type

    return {
        "associates": [
            {
                "user_id": a.id,
                "full_name": a.full_name,
                "email": a.email,
                "team_area": profiles.get(a.id),
                "today_status": today_by_user.get(a.id),  # "leave" | "wfh" | None
            }
            for a in associates
        ]
    }


@router.put("/{user_id}/team-area")
async def set_team_area(
    user_id: str,
    payload: dict,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """Assigns (or reassigns) which team area an associate supports - e.g.
    'MM', 'FI', 'SD', 'ABAP', or a non-TCS queue name. Everyone sharing a
    team_area becomes each other's backup for the Leave conflict rule."""
    team_area = (payload.get("team_area") or "").strip()
    if not team_area:
        raise HTTPException(status_code=400, detail="team_area is required")
    associate = db.query(models.User).filter(models.User.id == user_id, models.User.role == "associate").first()
    if not associate:
        raise HTTPException(status_code=404, detail="Associate not found")

    profile = _profile_for(db, user_id)
    if profile:
        profile.team_area = team_area
    else:
        profile = models.AssociateProfile(user_id=user_id, team_area=team_area)
        db.add(profile)
    db.commit()
    return {"user_id": user_id, "team_area": team_area}


@router.post("/leave-requests")
async def create_leave_request(
    payload: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """An associate files their own Leave or WFH request. This only ever
    creates a 'pending' row - it has no effect on anything until an SDM/admin
    approves it below. No conflict check happens here on purpose: two people
    are allowed to each have a *pending* overlapping Leave request at the
    same time (whoever gets approved first wins); the conflict is only
    enforced at approval time, where it actually matters."""
    request_type = payload.get("request_type")
    if request_type not in VALID_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail=f"request_type must be one of {VALID_REQUEST_TYPES}")
    date_from = _parse_date(payload.get("date_from"), "date_from")
    date_to = _parse_date(payload.get("date_to"), "date_to")
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to must be on or after date_from")

    req = models.LeaveRequest(
        associate_user_id=current_user.id,
        request_type=request_type,
        date_from=date_from,
        date_to=date_to,
        reason=(payload.get("reason") or "").strip() or None,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _serialize(req)


@router.get("/leave-requests")
async def list_leave_requests(
    status: str | None = None,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    """SDM/admin review queue. Each pending Leave row also reports whether
    approving it right now would conflict with someone else already
    approved in the same area, so the SDM can see the problem before
    clicking Approve instead of just getting a 409 after the fact."""
    q = db.query(models.LeaveRequest)
    if status:
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {VALID_STATUSES}")
        q = q.filter(models.LeaveRequest.status == status)
    requests = q.order_by(models.LeaveRequest.created_at.desc()).all()

    out = []
    for r in requests:
        profile = _profile_for(db, r.associate_user_id)
        team_area = profile.team_area if profile else None
        conflict = None
        if r.request_type == "leave" and r.status == "pending" and team_area:
            c = find_leave_conflict(db, team_area, r.date_from, r.date_to, exclude_request_id=r.id)
            if c:
                conflict = {
                    "associate_name": c.associate.full_name if c.associate else "Unknown",
                    "date_from": c.date_from.date().isoformat(),
                    "date_to": c.date_to.date().isoformat(),
                }
        row = _serialize(r)
        row["team_area"] = team_area
        row["conflict"] = conflict
        out.append(row)
    return {"requests": out}


@router.get("/leave-requests/mine")
async def my_leave_requests(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The requesting associate's own Leave/WFH history - what the Profile
    page reads to show a request as verified once an SDM has approved it."""
    requests = (
        db.query(models.LeaveRequest)
        .filter(models.LeaveRequest.associate_user_id == current_user.id)
        .order_by(models.LeaveRequest.created_at.desc())
        .all()
    )
    return {"requests": [_serialize(r) for r in requests]}


@router.post("/leave-requests/{request_id}/approve")
async def approve_leave_request(
    request_id: str,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    req = db.query(models.LeaveRequest).filter(models.LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave/WFH request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    if req.request_type == "leave":
        profile = _profile_for(db, req.associate_user_id)
        if profile:
            conflict = find_leave_conflict(db, profile.team_area, req.date_from, req.date_to, exclude_request_id=req.id)
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Cannot approve: {conflict.associate.full_name if conflict.associate else 'another associate'} "
                        f"in the {profile.team_area} area is already approved for Leave "
                        f"{conflict.date_from.date().isoformat()} to {conflict.date_to.date().isoformat()}, "
                        "which overlaps this request. Only one associate per area may be on Leave at a time."
                    ),
                )
    # WFH: no conflict check - both associates in an area can WFH together.

    req.status = "approved"
    req.reviewed_by_user_id = current_user.id
    req.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(req)
    return _serialize(req)


@router.post("/leave-requests/{request_id}/reject")
async def reject_leave_request(
    request_id: str,
    payload: dict | None = None,
    current_user: models.User = Depends(require_uploader),
    db: Session = Depends(get_db),
):
    req = db.query(models.LeaveRequest).filter(models.LeaveRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Leave/WFH request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    req.status = "rejected"
    req.reviewed_by_user_id = current_user.id
    req.reviewed_at = datetime.utcnow()
    req.review_note = ((payload or {}).get("review_note") or "").strip() or None
    db.commit()
    db.refresh(req)
    return _serialize(req)


def _serialize(r: models.LeaveRequest) -> dict:
    return {
        "id": r.id,
        "associate_user_id": r.associate_user_id,
        "associate_name": r.associate.full_name if r.associate else None,
        "request_type": r.request_type,
        "date_from": r.date_from.date().isoformat(),
        "date_to": r.date_to.date().isoformat(),
        "reason": r.reason,
        "status": r.status,
        "reviewed_by": r.reviewed_by.full_name if r.reviewed_by else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "review_note": r.review_note,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
