import math

from mathutils import Vector

from kit import frame


class Body:
    """A capsule hull revolved around X with helpers for placing details on its surface."""

    def __init__(self, length, radius, p_front=2.5, p_back=2.5, x0=0.0):
        self.half = length / 2
        self.radius = radius
        self.p_front = p_front
        self.p_back = p_back
        self.x0 = x0

    def r(self, x):
        t = (x - self.x0) / self.half
        if abs(t) >= 1:
            return 0.0
        p = self.p_front if t > 0 else self.p_back
        return self.radius * (1 - abs(t) ** p) ** (1 / p)

    def profile(self, samples=48):
        pts = []
        for i in range(samples + 1):
            s = -1 + 2 * i / samples
            t = math.copysign(abs(s) ** 0.8, s)
            pts.append((self.x0 + t * self.half, self.r(self.x0 + t * self.half)))
        return pts

    def point(self, x, theta, lift=0.0):
        """Surface point at axial position x and angle theta (0 faces -Y, pi/2 faces +Z)."""
        n = self.normal(x, theta)
        r = self.r(x)
        return Vector((x, -r * math.cos(theta), r * math.sin(theta))) + n * lift

    def normal(self, x, theta):
        h = 1e-3
        dr = (self.r(x + h) - self.r(x - h)) / (2 * h)
        return Vector((-dr, -math.cos(theta), math.sin(theta))).normalized()

    def frame(self, x, theta, lift=0.0, up=(0, 0, 1)):
        return frame(self.point(x, theta, lift), self.normal(x, theta), up)

    def ray(self, origin, direction):
        """Point where a ray from inside the body exits its surface."""
        o, d = Vector(origin), Vector(direction).normalized()
        lo, hi = 0.0, 4 * self.half
        for _ in range(40):
            mid = (lo + hi) / 2
            p = o + d * mid
            inside = math.hypot(p.y, p.z) < self.r(p.x)
            lo, hi = (mid, hi) if inside else (lo, mid)
        p = o + d * lo
        theta = math.atan2(p.z, -p.y)
        return p, self.normal(p.x, theta)

    def ring(self, x, lift=0.0, count=24):
        return [self.point(x, 2 * math.pi * i / count, lift) for i in range(count)]


def face_dir(yaw, pitch):
    """Direction leaning from -Y toward +X by `yaw` and upward by `pitch` (degrees)."""
    y, p = math.radians(yaw), math.radians(pitch)
    return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
