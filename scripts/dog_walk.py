# Find a steady, straight walk in the dog motion capture (Zhang, Starke, Komura and Saito, "Mode-Adaptive Neural
# Networks for Quadruped Motion Control", SIGGRAPH 2018; CC BY-NC 4.0) and save one cycle of it for the polar bear.
#   uv run --with numpy python scripts/dog_walk.py BVH_DIR blender/dog_walk.json
# The cycle is saved in the dog's heading frame (x forward, y up, z to its left, in its own centimetres): each paw's
# path, the hips' height, and how the hips, chest and head turn over the cycle.
import json
import math
import sys
from pathlib import Path

import numpy as np

PAWS = {'LH': 'LeftFoot', 'RH': 'RightFoot', 'LF': 'LeftHand', 'RF': 'RightHand'}
BODY = ['Hips', 'Spine1', 'Head']


def parse(path):
    lines = Path(path).read_text().split('\n')
    joints, order, stack = {}, [], []
    pending = None
    i = 0
    while not lines[i].strip().startswith('MOTION'):
        t = lines[i].split()
        if t and t[0] in ('ROOT', 'JOINT'):
            parent = next((x for x in reversed(stack) if isinstance(x, str)), None)
            joints[t[1]] = {'parent': parent, 'end': None}
            order.append(t[1])
            pending = t[1]
        elif t and t[0] == 'End':
            pending = ('end', stack[-1])
        elif t and t[0] == '{':
            stack.append(pending)
        elif t and t[0] == '}':
            stack.pop()
        elif t and t[0] == 'OFFSET':
            off = np.array([float(x) for x in t[1:4]])
            top = stack[-1]
            if isinstance(top, tuple):
                joints[top[1]]['end'] = off
            else:
                joints[top]['offset'] = off
        elif t and t[0] == 'CHANNELS':
            joints[stack[-1]]['channels'] = t[2:]
        i += 1
    frames = int(lines[i + 1].split()[1])
    dt = float(lines[i + 2].split()[2])
    data = np.array([[float(x) for x in l.split()] for l in lines[i + 3:i + 3 + frames] if l.strip()])
    return joints, order, data, dt


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 'X':
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y':
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def forward(joints, order, row):
    """World position and rotation of every joint, and of each end site, for one frame."""
    pos, mat, col = {}, {}, 0
    for name in order:
        j = joints[name]
        local = np.eye(3)
        offset = j['offset'].copy()
        for ch in j['channels']:
            v = row[col]
            col += 1
            if ch.endswith('position'):
                offset['XYZ'.index(ch[0])] = v
            else:
                local = local @ rot(ch[0], v)
        if j['parent'] is None:
            pos[name], mat[name] = offset, local
        else:
            p = j['parent']
            pos[name] = pos[p] + mat[p] @ offset
            mat[name] = mat[p] @ local
        if j['end'] is not None:
            pos[name + '_end'] = pos[name] + mat[name] @ j['end']
    return pos, mat


def clip_motion(path):
    joints, order, data, dt = parse(path)
    P = {k: [] for k in ['Hips', 'Head_end'] + [v + '_end' for v in PAWS.values()]}
    M = {k: [] for k in BODY}
    for row in data:
        pos, mat = forward(joints, order, row)
        for k in P:
            P[k].append(pos[k])
        for k in M:
            M[k].append(mat[k])
    return {k: np.array(v) for k, v in P.items()}, {k: np.array(v) for k, v in M.items()}, dt


def walk_windows(P, dt, seconds=3.0):
    """Stretches where the dog walks steadily in a straight line, scored by how steady they are."""
    hips = P['Hips'][:, [0, 2]]
    n = int(seconds / dt)
    found = []
    for s in range(0, len(hips) - n, n // 6):
        seg = hips[s:s + n]
        v = np.diff(seg, axis=0) / dt
        speed = np.linalg.norm(v, axis=1)
        heading = np.unwrap(np.arctan2(v[:, 1], v[:, 0]))
        # A walk: brisk but well short of a trot, holding its pace and its line.
        if not (35 < speed.mean() < 110):
            continue
        score = speed.std() / speed.mean() + np.ptp(heading) * 0.5
        found.append((score, s, s + n, speed.mean()))
    return sorted(found)


def cycle_in(P, s, e, dt):
    """One stride cycle from a footfall of the left hind paw to the next, within frames s..e."""
    h = P['LeftFoot_end'][s:e, 1]
    h = h - h.min()
    lo = h < 1.5
    downs = [i for i in range(1, len(h)) if lo[i] and not lo[i - 1]]
    best = None
    for a, b in zip(downs, downs[1:]):
        period = (b - a) * dt
        if 0.6 < period < 1.6:
            best = (s + a, s + b) if best is None else best
    return best


def gait(P, a, b):
    """Share of the cycle each paw spends on the ground, and when the left fore lands after the left hind."""
    duty, land = {}, {}
    for leg, joint in PAWS.items():
        h = P[joint + '_end'][a:b + 1, 1]
        down = h < h.min() + 1.5
        duty[leg] = down[:-1].mean()
        steps = [i for i in range(1, len(h)) if down[i] and not down[i - 1]]
        land[leg] = steps[0] / (b - a) if steps else None
    return duty, land


def heading_frame(P, a, b):
    """Origin, forward and left axes of the dog's travel over frames a..b, on the ground."""
    start = P['Hips'][a]
    travel = P['Hips'][b] - start
    fwd = np.array([travel[0], 0, travel[2]])
    fwd /= np.linalg.norm(fwd)
    up = np.array([0.0, 1, 0])
    left = np.cross(up, fwd)
    return start, fwd, up, left, travel


def angles(m):
    """Roll about forward, pitch about left, yaw about up, of a rotation in heading axes (forward, up, left)."""
    f = m[:, 0]
    pitch = math.asin(max(-1, min(1, f[1])))
    yaw = math.atan2(-f[2], f[0])
    u = m[:, 1]
    roll = math.atan2(u[2], u[1])
    return roll, pitch, yaw


def main():
    src, out = sys.argv[1], sys.argv[2]
    candidates = []
    for f in sorted(Path(src).glob('*.bvh')):
        P, M, dt = clip_motion(f)
        for score, s, e, speed in walk_windows(P, dt)[:4]:
            c = cycle_in(P, s, e, dt)
            if not c:
                continue
            duty, land = gait(P, *c)
            # A true walk, as a bear walks: each paw down most of the time, the fore landing a quarter cycle or so
            # after the hind on the same side.
            if land['LF'] is None:
                continue
            lag = (land['LF'] - (land['LH'] or 0)) % 1
            walkiness = abs(np.mean(list(duty.values())) - 0.65) * 3 + abs(lag - 0.22) * 2
            candidates.append((score + walkiness, f.name, c, speed))
    candidates.sort()
    for c in candidates[:8]:
        print('candidate', c)
    score, name, (a, b), speed = candidates[0]
    P, M, dt = clip_motion(Path(src) / name)
    origin, fwd, up, left, travel = heading_frame(P, a, b)
    basis = np.stack([fwd, up, left])
    n = b - a
    ground = min(P[v + '_end'][a:b, 1].min() for v in PAWS.values())
    frames = []
    mean_rot = {k: None for k in BODY}
    rots = {k: [basis @ M[k][i] for i in range(a, b + 1)] for k in BODY}
    for k in BODY:
        a3 = np.array([angles(r) for r in rots[k]])
        mean_rot[k] = np.arctan2(np.sin(a3).mean(0), np.cos(a3).mean(0))
    for i in range(a, b + 1):
        t = (i - a) / n
        # Each position relative to where the hips would be travelling at a steady pace.
        base = origin + travel * t
        frame = {'paws': {}, 'hips': float(P['Hips'][i][1] - ground)}
        for leg, joint in PAWS.items():
            rel = P[joint + '_end'][i] - base
            frame['paws'][leg] = [float(rel @ fwd), float(P[joint + '_end'][i][1] - ground), float(rel @ left)]
        wrap = lambda v: (v + math.pi) % (2 * math.pi) - math.pi
        frame['turn'] = {k: [float(wrap(x)) for x in (np.array(angles(rots[k][i - a])) - mean_rot[k])] for k in BODY}
        frames.append(frame)
    result = {'source': name, 'frames': frames, 'period': n * dt, 'stride': float(np.linalg.norm(travel[[0, 2]])),
              'hips_height': float(np.mean([f['hips'] for f in frames]))}
    Path(out).write_text(json.dumps(result))
    print('saved', name, a, b, 'period', round(n * dt, 3), 'stride', round(result['stride'], 1), 'speed', round(speed, 1))


main()
