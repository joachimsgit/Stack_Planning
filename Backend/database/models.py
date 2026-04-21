import json
import time
from sqlalchemy import Boolean, Column, Integer, String, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from database.database import Base


class FlakeNote(Base):
    __tablename__ = "flake_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    flake_id = Column(Integer, nullable=False, unique=True, index=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(Float, nullable=False, default=lambda: time.time())

    def to_dict(self):
        return {
            "flake_id": self.flake_id,
            "notes": self.notes,
            "updated_at": self.updated_at,
        }


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True)
    created_at = Column(Float, nullable=False, default=lambda: time.time())

    stacks = relationship("Stack", back_populates="user")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at,
            "stack_count": len(self.stacks),
        }


class Stack(Base):
    __tablename__ = "stacks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    created_at = Column(Float, nullable=False, default=lambda: time.time())
    updated_at = Column(Float, nullable=False, default=lambda: time.time(), onupdate=lambda: time.time())
    notes = Column(String(1000), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User", back_populates="stacks")
    layers = relationship(
        "StackLayer",
        back_populates="stack",
        cascade="all, delete-orphan",
        order_by="StackLayer.layer_index",
    )

    def to_dict(self, include_layers=False):
        d = {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "notes": self.notes,
            "layer_count": len(self.layers),
            "user_id": self.user_id,
            "username": self.user.name if self.user else None,
        }
        if include_layers:
            d["layers"] = [layer.to_dict() for layer in self.layers]
        return d


class StackLayer(Base):
    __tablename__ = "stack_layers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    stack_id = Column(Integer, ForeignKey("stacks.id", ondelete="CASCADE"), nullable=False, index=True)
    layer_index = Column(Integer, nullable=False, default=0)

    # Reference into the GMM database (no FK constraint — different DB)
    # Nullable so that shape-only layers don't require a flake reference
    flake_id = Column(Integer, nullable=True, index=True)

    # Cached flake fields so the stack stays readable if the flake is deleted
    flake_material = Column(String(255), nullable=True)
    flake_size = Column(Float, nullable=True)
    flake_thickness = Column(String(255), nullable=True)
    flake_path = Column(String(255), nullable=True)

    # Visualisation transform
    pos_x = Column(Float, nullable=False, default=0.0)
    pos_y = Column(Float, nullable=False, default=0.0)
    rotation = Column(Float, nullable=False, default=0.0)        # degrees
    opacity = Column(Float, nullable=False, default=0.7)
    brightness = Column(Float, nullable=False, default=1.0)
    contrast = Column(Float, nullable=False, default=1.0)
    image_filename = Column(String(64), nullable=False, default="eval_img.jpg")

    # Shape-specific fields (NULL for regular flake layers)
    is_shape = Column(Boolean, nullable=False, default=False)
    shape_type = Column(String(32), nullable=True)        # "rect" | "freehand"
    shape_data = Column(Text, nullable=True)              # JSON string
    shape_color = Column(String(32), nullable=True)
    shape_stroke_width = Column(Float, nullable=True, default=2.0)

    stack = relationship("Stack", back_populates="layers")

    def to_dict(self):
        d = {
            "id": self.id,
            "stack_id": self.stack_id,
            "layer_index": self.layer_index,
            "pos_x": self.pos_x,
            "pos_y": self.pos_y,
            "rotation": self.rotation,
            "opacity": self.opacity,
            "brightness": self.brightness,
            "contrast": self.contrast,
            "is_shape": bool(self.is_shape),
        }
        if self.is_shape:
            d["shape_type"] = self.shape_type
            d["shape_data"] = json.loads(self.shape_data) if self.shape_data else None
            d["shape_color"] = self.shape_color
            d["shape_stroke_width"] = self.shape_stroke_width
        else:
            d["flake_id"] = self.flake_id
            d["flake_material"] = self.flake_material
            d["flake_size"] = self.flake_size
            d["flake_thickness"] = self.flake_thickness
            d["flake_path"] = self.flake_path
            d["image_filename"] = self.image_filename
        return d
