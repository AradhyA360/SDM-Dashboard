"""
Sends incident-update emails from the Incident Command Center. No email
server is available yet, so this is written to degrade safely: if
SMTP_HOST isn't configured, it doesn't attempt a connection at all - it
just reports "not_configured" so the caller can log the attempt anyway
(see EmailLog) and show the SDM an honest status instead of a silent
no-op or a confusing stack trace. Once real SMTP settings are added to
the environment (see app/config.py), sends start actually going out with
no code change here.
"""
import smtplib
from email.mime.text import MIMEText

from app.config import settings


def send_email(sender: str, recipients: list, subject: str, body: str) -> dict:
    if not settings.SMTP_HOST:
        return {
            "status": "not_configured",
            "error": "No SMTP server is configured on this backend yet. The message was logged but not delivered.",
        }

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USERNAME:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(sender, recipients, msg.as_string())
        return {"status": "sent", "error": None}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
