/**
 * Hidden debug panel: hold GO's purple frame for 1 s (or tap the frame 5 times in 2 s).
 * Money / points / tools / cards / dice / speed / state flags of the human players, no rebuild needed.
 */
import type { Game } from '../core/game';
import type { Player } from '../core/types';
import { CARDS, TYCOON_CARDS, KB_CARDS } from '../core/modules/cards';
import { TOOLS } from '../core/modules/tools';
import type { BoardView } from './board-view';
import './debug-panel.css';

const ALL_CARDS = [...CARDS, ...TYCOON_CARDS, ...KB_CARDS];
const MAX_HELD = 9;
const SPEEDS = [
  { label: '慢', ms: 60, wait: 1 },
  { label: '中', ms: 40, wait: 80 / 120 },
  { label: '快', ms: 20, wait: 40 / 120 },
  { label: '極快', ms: 10, wait: 0.15 },
];

export class DebugPanel {
  private root: HTMLElement | null = null;
  private open = false;
  private tapTimes: number[] = [];
  private detachTap: (() => void) | null = null;
  private speedIdx = 0;

  constructor(
    private game: Game,
    private view: BoardView,
    private refresh: () => void,
  ) {}

  /** The frame stays visible while held; GO's centre departs immediately on release. */
  attachTap(target: HTMLElement): void {
    this.detachTap?.();
    let hold: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const cancelHold = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    const down = (e: PointerEvent) => {
      cancelHold();
      // Dice slots and GO's centre retain their normal actions. Only the purple frame opens DEBUG.
      if (!e.isPrimary || e.button !== 0 || !(e.target instanceof Element)
        || e.target.closest('.go-hit, .go-slots')) return;
      const now = Date.now();
      this.tapTimes = this.tapTimes.filter(t => now - t < 2000);
      this.tapTimes.push(now);
      if (this.tapTimes.length >= 5) {
        this.tapTimes = [];
        this.toggle();
        return;
      }
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        hold = null;
        this.tapTimes = [];
        if (target.isConnected && !target.hidden) this.toggle();
      }, 1000) };
    };
    const move = (e: PointerEvent) => {
      if (hold?.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) {
        cancelHold();
        this.tapTimes = [];
      }
    };
    const up = (e: PointerEvent) => { if (hold?.id === e.pointerId) cancelHold(); };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('lostpointercapture', up);
    this.detachTap = () => {
      cancelHold();
      this.tapTimes = [];
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('lostpointercapture', up);
    };
  }

  destroy(): void { this.detachTap?.(); this.detachTap = null; this.close(); }

  toggle(): void { if (this.open) this.close(); else this.openPanel(); }
  close(): void { this.open = false; this.root?.remove(); this.root = null; }
  isOpen(): boolean { return this.open; }

  private humans(): Player[] { return this.game.players.filter(p => p.whoPlays === 1 && !p.bankrupt); }

  private openPanel(): void {
    this.open = true;
    let idx = 0;
    try { idx = Math.max(0, Math.min(SPEEDS.length - 1, Number(localStorage.getItem('rich4.speed') ?? 0))); } catch { /* ok */ }
    this.speedIdx = idx;
    const el = document.createElement('div');
    el.className = 'dbg-panel';
    el.innerHTML = this.buildHtml();
    document.body.appendChild(el);
    this.root = el;
    this.bind(el);
  }

  private buildHtml(): string {
    const rows = this.humans().map((p, i) => {
      const g = this.game;
      return `
      <div class="dbg-player">
        <div class="dbg-pname">${g.name(p.id)}</div>
        <div class="dbg-row">
          <button data-act="cash+" data-p="${i}">+10萬</button>
          <button data-act="cash++" data-p="${i}">+100萬</button>
          <button data-act="cash--" data-p="${i}">-10萬</button>
        </div>
        <div class="dbg-row">
          <button data-act="pts+" data-p="${i}">+500分</button>
          <button data-act="pts++" data-p="${i}">+5000分</button>
          <span class="dbg-val">💵 ${p.cash.toLocaleString()} 🎟 ${p.points}</span>
        </div>
        <div class="dbg-tools">
          ${TOOLS.slice(0, 13).map(t =>
            `<button data-act="tool" data-p="${i}" data-id="${t.id}">${t.name}×${p.tools[t.id - 1]}</button>`).join('')}
        </div>
        <div class="dbg-row">
          <button data-act="card" data-p="${i}">＋卡</button>
          <button data-act="cards-clear" data-p="${i}">清卡</button>
          <span class="dbg-val">${p.cards.length}張</span>
        </div>
      </div>`;
    }).join('');
    return `
    <div class="dbg-head"><span>DEBUG</span><button class="dbg-close">✕</button></div>
    ${rows}
    <div class="dbg-foot">
      <button data-act="dice">遙控骰</button>
      <button data-act="speed">速度:${SPEEDS[this.speedIdx]?.label ?? '慢'}</button>
      <button data-act="god">清狀態</button>
      <button data-act="win">直接贏</button>
    </div>`;
  }

  private bind(el: HTMLElement): void {
    el.addEventListener('click', ev => {
      const btn = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (btn?.classList.contains('dbg-close')) { this.close(); return; }
      if (!btn?.dataset.act) return;
      const i = Number(btn.dataset.p ?? 0);
      const p = this.humans()[i];
      const act = btn.dataset.act;
      const g = this.game;
      switch (act) {
        case 'cash+': if (p) p.cash += 100000; break;
        case 'cash++': if (p) p.cash += 1000000; break;
        case 'cash--': if (p) p.cash = Math.max(0, p.cash - 100000); break;
        case 'pts+': if (p) p.points = (p.points + 500) & 0xffff; break;
        case 'pts++': if (p) p.points = (p.points + 5000) & 0xffff; break;
        case 'tool': {
          const id = Number(btn.dataset.id);
          if (p && p.tools[id - 1] < MAX_HELD) p.tools[id - 1] += 1;
          break;
        }
        case 'cards-clear': if (p) p.cards.length = 0; break;
        case 'card': if (p) this.pickCard(p); break;
        case 'dice': {
          const raw = prompt('遙控骰子 (1-6):');
          if (raw) {
            const v = Number(raw);
            if (v >= 1 && v <= 6) { g.tools.remoteDice = v; g.tools.pending = 'depart'; }
          }
          break;
        }
        case 'speed': this.cycleSpeed(); break;
        case 'god': for (const q of this.humans()) { q.hospital = 0; q.prison = 0; q.sleep = 0; q.turtle = 0; q.stay = 0; q.sleepwalk = 0; } break;
        case 'win': for (const q of g.players) q.bankrupt = (q.whoPlays !== 1); for (const q of this.humans()) q.cash = 999999999; break;
      }
      this.refresh();
      this.rebuild();
    });
  }

  private rebuild(): void {
    if (!this.root) return;
    this.root.innerHTML = this.buildHtml();
  }

  private pickCard(p: Player): void {
    const list = ALL_CARDS.map(c => `${c.id} ${c.name}`).join(' ');
    const raw = prompt(`輸入卡片 ID (${list}):`);
    if (!raw) return;
    const id = Number(raw);
    if (ALL_CARDS.some(c => c.id === id) && p.cards.length < 15) p.cards.push(id);
  }

  private cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    const s = SPEEDS[this.speedIdx];
    this.view.tickMs = s.ms;
    try { localStorage.setItem('rich4.speed', String(this.speedIdx)); } catch { /* ok */ }
  }
}
