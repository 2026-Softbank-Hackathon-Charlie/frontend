// A popup with a video when a migration finishes. It opens when the run that is on screen turns to "succeeded" while
// the page is open, not when the page is opened on a run that ended earlier, and not for a rollback. A button
// beside it plays it again.
import { useEffect, useId, useRef, useState } from "react";
import type { Run } from "../api/types";
import { Icon } from "./Icon";

export const COMPLETION_VIDEO_SRC = import.meta.env.BASE_URL + "media/migration-complete.mp4";

/** True when the run just turned to succeeded: the same run as before, not succeeded then and succeeded now, and not a rollback. */
export function justSucceeded(prev: { id?: string; status?: string }, run?: Pick<Run, "runId" | "status" | "rollbackOf">): boolean {
  return !!run && prev.id === run.runId && prev.status !== undefined && prev.status !== "succeeded" && run.status === "succeeded" && !run.rollbackOf;
}

export function CompletionVideo({ run }: { run?: Run }) {
  const [open, setOpen] = useState(false);
  const seen = useRef<{ id?: string; status?: string }>({});
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (justSucceeded(seen.current, run)) setOpen(true);
    seen.current = { id: run?.runId, status: run?.status };
  }, [run?.runId, run?.status, run?.rollbackOf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  const done = run?.status === "succeeded" && !run.rollbackOf;
  return (
    <>
      {done && (
        <div className="mg-video-bar">
          <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
            <Icon name="play" /> 완료 영상 보기
          </button>
        </div>
      )}
      {open && (
        <div className="mg-pop-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="mg-pop" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
            <header>
              <h2 id={titleId}>이전이 끝났습니다</h2>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                닫기
              </button>
            </header>
            <video src={COMPLETION_VIDEO_SRC} controls autoPlay muted playsInline aria-label="이전 완료 영상" />
          </div>
        </div>
      )}
    </>
  );
}
