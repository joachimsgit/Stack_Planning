import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import scoped_session, sessionmaker, DeclarativeBase


class Base(DeclarativeBase):
    pass


def create_db_engine(config: dict):
    db_path = config.get("database_path", "stacks.db")
    # Resolve relative paths against the Backend directory
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.path.dirname(__file__), "..", db_path)
    engine = create_engine(f"sqlite:///{os.path.abspath(db_path)}")
    return engine


def init_db(engine):
    from database.models import User, Stack, StackLayer, FlakeNote  # noqa: F401 — registers models
    Base.metadata.create_all(bind=engine)


def run_migrations(engine):
    """Apply schema changes that create_all can't handle (new columns on existing tables)."""
    with engine.connect() as conn:
        stacks_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(stacks)"))}
        if "user_id" not in stacks_cols:
            conn.execute(text(
                "ALTER TABLE stacks ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
            ))
            conn.commit()

        layers_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(stack_layers)"))}
        shape_migrations = [
            ("is_shape",           "INTEGER NOT NULL DEFAULT 0"),
            ("shape_type",         "TEXT"),
            ("shape_data",         "TEXT"),
            ("shape_color",        "TEXT"),
            ("shape_stroke_width", "REAL DEFAULT 2.0"),
            ("name",               "TEXT"),
        ]
        for col_name, col_def in shape_migrations:
            if col_name not in layers_cols:
                conn.execute(text(f"ALTER TABLE stack_layers ADD COLUMN {col_name} {col_def}"))
        conn.commit()

        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_stacks_user_id ON stacks (user_id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_stack_layers_stack_id ON stack_layers (stack_id)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_stack_layers_flake_id ON stack_layers (flake_id)"
        ))
        conn.commit()


def create_session_factory(engine):
    session_factory = sessionmaker(bind=engine)
    return scoped_session(session_factory)
