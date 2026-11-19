import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * How hard the gateway's models think.
 *
 * OpenBot reads thinking levels from models.dev for the providers it names (OpenAI, Anthropic,
 * Google, xAI), and a model behind a custom `OPENAI_BASE_URL` resolves to `gateway`, which no
 * models.dev section describes: the composer's own thinking column stays empty for it, and the
 * server drops an effort it cannot check. This deployment runs the app in front of a small local
 * gateway that adds the effort to every model call, so the level is one setting for the whole
 * gateway, set here instead of on a page of its own.
 *
 * The menu is drawn by hand against the page, not by the popup primitives: it hangs above a
 * composer that clips its own overflow, so it is placed from the button's own rectangle and portalled
 * out of that box.
 */

const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** The gateway's own port on the host this page came from, so LAN and Tailscale both work. */
function endpoint(): string {
  return `${window.location.protocol}//${window.location.hostname}:20129/effort`;
}

export function GatewayThinking() {
  const [effort, setEffort] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch(endpoint())
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { effort?: unknown } | null) => {
        if (live && typeof body?.effort === "string") setEffort(body.effort);
      })
      .catch(() => {
        /* No gateway in front of this deployment: the control is simply not shown. */
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (effort === null) return null;

  const toggle = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      setPlacement({
        left: box.left,
        bottom: window.innerHeight - box.top + 8,
      });
    }
    setOpen((was) => !was);
  };

  const save = (next: string) => {
    setEffort(next);
    setOpen(false);
    fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effort: next }),
    }).catch(() => {
      /* Left as chosen: the next read says what the gateway kept. */
    });
  };

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Thinking: ${LABELS[effort] ?? effort}`}
        className="h-8 shrink-0 gap-1 px-2 font-normal text-muted-foreground"
        onClick={toggle}
        ref={trigger}
        size="sm"
        type="button"
        variant="ghost"
      >
        <span className="truncate">{LABELS[effort] ?? effort}</span>
        <IconChevronDown aria-hidden className="size-3.5 shrink-0" />
      </Button>
      {open && placement
        ? createPortal(
            <>
              {/* A click anywhere else closes it, as a menu closes. */}
              <div
                aria-hidden
                className="fixed inset-0 z-50"
                onMouseDown={() => setOpen(false)}
              />
              <div
                className="fixed z-50 w-44 origin-bottom rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
                role="listbox"
                style={{ left: placement.left, bottom: placement.bottom }}
              >
                <p className="px-1.5 py-1 text-muted-foreground text-xs">
                  Thinking · every chat
                </p>
                {LEVELS.map((level) => (
                  <button
                    aria-selected={level === effort}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent",
                      level === effort && "font-medium",
                    )}
                    key={level}
                    onClick={() => save(level)}
                    role="option"
                    type="button"
                  >
                    {LABELS[level]}
                    {level === effort ? <span aria-hidden>✓</span> : null}
                  </button>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
