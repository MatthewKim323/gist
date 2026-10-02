"use client";
import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { Rig, SHAPE_BY_ID, COLOR_BY_ID, EXPRESSION_BY_ID, STATE_BY_ID, DEFAULT_SHAPE, DEFAULT_COLOR, DEFAULT_EXPRESSION, clamp, ease } from "@/lib/captain/engine";
import { frameMarkup, VIEW, type Frame } from "@/lib/captain/render";
import { defaultCycle, followLook, locate, startOf, LOOK_RETURN, type Block, type Look } from "@/lib/captain/cycles";
import { DEFAULT_HAT, type HatId } from "@/lib/captain/hats";
import { t, useLang } from "@/lib/captain/i18n";

const STEP = 1 / 60;
const DEFAULT_BLOCKS = defaultCycle().blocks;

export type BotProps = {
  size?: number;
  shape?: string;
  color?: string;
  expression?: string;
  hat?: HatId;
  paper?: string;
  frozenAt?: number;
  cycle?: Block[];
  follow?: boolean;
  gaze?: ((t: number) => Look) | null;
  block?: number;
  onBlock?: (n: number) => void;
  state?: string;
  onState?: (s: string) => void;
  playing?: boolean;
  elapsed?: number;
  onElapsed?: (n: number) => void;
  className?: string;
};
export type BotHandle = { seek: (block: number, t?: number) => void; rendAt: (t: number) => void; el: SVGSVGElement | null };

export const Bot = memo(
  forwardRef<BotHandle, BotProps>(function Bot(props, ref) {
    useLang();
    const {
      size = 320,
      shape = DEFAULT_SHAPE,
      color = DEFAULT_COLOR,
      expression = DEFAULT_EXPRESSION,
      hat = DEFAULT_HAT,
      paper = "#f9f9f9",
      frozenAt,
      cycle = DEFAULT_BLOCKS,
      follow = false,
      gaze = null,
      className,
    } = props;
    const P = useRef(props);
    P.current = props;
    const svg = useRef<SVGSVGElement>(null);
    const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);

    const radii = SHAPE_BY_ID.get(shape)?.radii ?? null;
    const hex = COLOR_BY_ID.get(color)?.hex ?? "#0a0a0c";
    const expr = EXPRESSION_BY_ID.get(expression) ?? null;
    const look = useRef({ color: hex, paper, hat, expression, cycle, follow, frozenAt });
    look.current = { color: hex, paper, hat, expression, cycle, follow, frozenAt };

    // one mutable machine per instance, like the original setup() closure
    const M = useRef<ReturnType<typeof machine> | null>(null);
    if (!M.current) M.current = machine();

    function machine() {
      const st = {
        block: props.block ?? 0,
        state: props.state ?? "idle",
        playing: props.playing ?? false,
        elapsed: props.elapsed ?? 0,
      };
      const u = new Rig(100, st.state, radii, expr);
      let frame: Frame = u.sample(frozenAt ?? 0);
      let raf = 0;
      let end = Infinity; // h
      let last = 0; // g
      let clock = 0; // _
      let start = 0; // v
      let pendingAt = 0; // x
      let lastIndex = -1; // C
      let pointer: { x: number; y: number } | null = null;
      let following = false;
      let followStart = 0;
      let gazeStart = 0;
      let gazing = false;

      const draw = () => {
        const el = svg.current;
        if (el) el.innerHTML = frameMarkup(frame, { uid, color: look.current.color, paper: look.current.paper, hat: look.current.hat, expression: look.current.expression });
      };
      const setState = (s: string) => {
        st.state = s;
        P.current.onState?.(s);
      };
      const setElapsed = (n: number) => {
        st.elapsed = n;
        P.current.onElapsed?.(n);
      };
      function enter(e: number, tm = 0) {
        const r = look.current.cycle[e];
        if (!r) {
          end = Infinity;
          return;
        }
        start = clock - tm;
        setElapsed(tm);
        setState(r.state);
        u.setState(r.state, clock);
        end = st.playing ? start + r.duration : Infinity;
      }
      function changeBlock(e: number, emit = true) {
        st.block = e;
        if (emit) P.current.onBlock?.(e);
        enter(e, pendingAt);
        pendingAt = 0;
      }
      function seek(e: number, tm = 0) {
        if (st.block === e) {
          enter(e, tm);
          return;
        }
        pendingAt = tm;
        changeBlock(e);
      }
      function rendAt(e: number) {
        const c = look.current.cycle;
        if (!c.length) return;
        const { index } = locate(c, e);
        if (index !== lastIndex) {
          const b = c[index];
          setState(b.state);
          if (index < lastIndex) u.reset(b.state, startOf(c, index));
          else u.setState(b.state, startOf(c, index));
          lastIndex = index;
        }
        frame = u.sample(e);
        draw();
      }
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "touch") pointer = { x: e.clientX, y: e.clientY };
      };
      const onLeave = () => (pointer = null);
      function release() {
        if (following) {
          u.setLook(null, clock, LOOK_RETURN);
          following = false;
        }
      }
      function track() {
        if (!STATE_BY_ID.get(st.state)?.baseFace) {
          release();
          return;
        }
        const r = svg.current?.getBoundingClientRect();
        if (!r || r.width === 0 || r.height === 0) return;
        if (!following) followStart = clock;
        const hw = Math.max(1, window.innerWidth / 2);
        const hh = Math.max(1, window.innerHeight / 2);
        u.setLook(
          followLook({
            nx: pointer ? clamp((pointer.x - (r.left + r.width / 2)) / hw, -1, 1) : 0,
            ny: pointer ? clamp((pointer.y - (r.top + r.height / 2)) / hh, -1, 1) : 0,
            tour: ease.easeOutQuint(clamp((clock - followStart) / LOOK_RETURN)),
            pointer: pointer !== null,
          }),
          clock,
        );
        following = true;
      }
      function setGaze(g: ((t: number) => Look) | null) {
        if (g) {
          gazeStart = clock;
          gazing = true;
          u.setLook(g(0), clock - STEP, STEP);
          return;
        }
        if (gazing) {
          u.setLook(null, clock);
          gazing = false;
        }
      }
      function tick(ts: number) {
        raf = requestAnimationFrame(tick);
        const dt = last ? Math.min((ts - last) / 1e3, 0.064) : 0;
        last = ts;
        clock += dt;
        const c = look.current.cycle;
        if (st.playing) {
          if (clock >= end && c.length) changeBlock((st.block + 1) % c.length);
          else setElapsed(clock - start);
        }
        const g = P.current.gaze;
        if (look.current.follow) track();
        else if (g) u.setLook(g(clock - gazeStart), clock, STEP);
        frame = u.sample(clock);
        draw();
      }
      function refreeze() {
        const f = look.current.frozenAt;
        if (f !== undefined) {
          frame = u.sample(f);
          draw();
        }
      }
      return {
        st,
        u,
        draw,
        seek,
        rendAt,
        changeBlock,
        enter,
        refreeze,
        setGaze,
        release,
        onMove,
        onLeave,
        clock: () => clock,
        setEnd: (n: number) => (end = n),
        mount() {
          if (look.current.frozenAt === undefined) {
            enter(st.block, st.elapsed);
            raf = requestAnimationFrame(tick);
          }
        },
        unmount() {
          cancelAnimationFrame(raf);
          window.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerleave", onLeave);
        },
        relink() {
          const c = look.current.cycle;
          if (!c.length) {
            end = Infinity;
            return;
          }
          const i = Math.min(st.block, c.length - 1);
          if (i !== st.block) {
            changeBlock(i);
            return;
          }
          end = st.playing ? start + c[i].duration : Infinity;
        },
        startOfBlock: () => start,
      };
    }
    const m = M.current;

    useImperativeHandle(ref, () => ({ seek: m.seek, rendAt: m.rendAt, get el() { return svg.current; } }), [m]);

    useLayoutEffect(() => {
      m.draw();
      m.mount();
      return () => m.unmount();
    }, [m]);

    // colour / paper / hat only repaint
    useLayoutEffect(() => m.draw(), [m, hex, paper, hat, expression]);

    // v-model watchers
    useEffect(() => {
      if (props.block !== undefined && props.block !== m.st.block) m.changeBlock(props.block, false);
    }, [m, props.block]);
    useEffect(() => {
      if (props.state !== undefined && props.state !== m.st.state) m.st.state = props.state;
      if (props.state !== undefined && m.u.state !== props.state) {
        m.u.setState(props.state, m.clock());
        m.refreeze();
      }
    }, [m, props.state]);
    const first = useRef(true);
    useEffect(() => {
      if (first.current) return;
      if (props.playing === undefined) return;
      m.st.playing = props.playing;
      if (props.playing) m.enter(m.st.block, m.st.elapsed);
      else m.setEnd(Infinity);
    }, [m, props.playing]);
    useEffect(() => {
      if (!first.current) m.relink();
    }, [m, cycle]);
    useEffect(() => {
      if (first.current) return;
      m.u.setShape(radii, m.clock());
      m.refreeze();
    }, [m, radii]);
    useEffect(() => {
      if (first.current) return;
      m.u.setExpression(expr, m.clock());
      m.refreeze();
    }, [m, expr]);
    useEffect(() => {
      if (!first.current) m.refreeze();
    }, [m, frozenAt]);
    useEffect(() => {
      m.setGaze(gaze);
    }, [m, gaze]);
    useEffect(() => {
      if (follow && frozenAt === undefined) {
        window.addEventListener("pointermove", m.onMove);
        document.addEventListener("pointerleave", m.onLeave);
        return;
      }
      window.removeEventListener("pointermove", m.onMove);
      document.removeEventListener("pointerleave", m.onLeave);
      m.release();
    }, [m, follow, frozenAt]);
    useEffect(() => {
      first.current = false;
    }, []);

    return (
      <svg
        ref={svg}
        className={className}
        width={size}
        height={size}
        viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
        role="img"
        aria-label="gist pilot"
      />
    );
  }),
);
