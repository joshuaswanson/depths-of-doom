// Phones and tablets steer with a thumb: a stick appears wherever a finger touches the game and follows it as it drags.
export const touchScreen = matchMedia('(pointer: coarse)').matches;

// How far the thumb travels from where it landed for full speed, as a share of the screen's shorter side.
const REACH = 0.12;
const DEAD_ZONE = 0.12;

export class TouchStick {
  constructor(surface, parent) {
    this.id = null;
    this.origin = { x: 0, y: 0 };
    this.vector = { x: 0, y: 0 };
    this.el = document.createElement('div');
    this.el.className = 'stick';
    this.el.innerHTML = '<i></i>';
    this.knob = this.el.firstChild;
    parent.append(this.el);
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.id !== null) return;
      this.id = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.el.style.left = `${e.clientX}px`;
      this.el.style.top = `${e.clientY}px`;
      this.el.classList.add('show');
      this.move(e);
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.id) this.move(e);
    });
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, (e) => {
        if (e.pointerId === this.id) this.release();
      });
    }
  }

  get active() {
    return this.id !== null;
  }

  // Dragging past the edge of the stick pulls its middle along behind the thumb, so turning back answers at once.
  move(e) {
    const reach = REACH * Math.min(window.innerWidth, window.innerHeight);
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > reach) {
      this.origin.x += dx * (1 - reach / d);
      this.origin.y += dy * (1 - reach / d);
      dx *= reach / d;
      dy *= reach / d;
      this.el.style.left = `${this.origin.x}px`;
      this.el.style.top = `${this.origin.y}px`;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const push = Math.min(1, d / reach);
    const scale = push < DEAD_ZONE ? 0 : (push - DEAD_ZONE) / (1 - DEAD_ZONE) / Math.max(push, 1e-6);
    this.vector = { x: (dx / reach) * scale, y: (-dy / reach) * scale };
  }

  release() {
    this.id = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = '';
    this.el.classList.remove('show');
  }
}
