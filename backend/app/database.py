from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
# pool_pre_ping + pool_recycle matter for MySQL specifically: MySQL (and most
# managed MySQL hosts) silently drop idle connections, which otherwise shows up
# as a "MySQL server has gone away" error on the first query after a lull.
# Both are harmless no-ops for SQLite.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
