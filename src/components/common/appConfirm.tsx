import * as React from "react";
import { Button, Modal } from "@/components/kit";

/**
 * 应用内 confirm / prompt —— 替代 window.confirm / window.prompt。
 *
 * 为什么不能再用原生的：Tauri 桌面版的 macOS WKWebView（wry）不实现
 * runJavaScriptConfirmPanel 这类对话框接口，`confirm()` 在桌面端会**静默返回
 * false**，所有「确认后执行」的删除/清空按钮点下去都没反应；浏览器里却一切正常。
 * 这里用 kit Modal 画一个 Promise 版对话框，网页与桌面行为一致。
 *
 * 用法（和原生 confirm 语义对齐）：
 *   if (!(await appConfirm("删除《xx》？"))) return;
 *   const input = await appPrompt("请输入 DELETE 以确认");
 *   if (input !== "DELETE") return;
 *
 * 多个请求会排队，逐个弹；Esc / 点遮罩 = 取消（confirm 得 false，prompt 得 null）。
 */

export type AppConfirmOptions = {
  /** 弹窗标题，默认「请确认」 */
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作时确认按钮标红 */
  danger?: boolean;
};

export type AppPromptOptions = AppConfirmOptions & {
  placeholder?: string;
};

type DialogRequest =
  | {
      id: number;
      kind: "confirm";
      message: string;
      options: AppConfirmOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      message: string;
      options: AppPromptOptions;
      resolve: (value: string | null) => void;
    };

const queue: DialogRequest[] = [];
let active: DialogRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function pump() {
  active = queue.shift() ?? null;
  emit();
}

function enqueue(request: Omit<DialogRequest, "id">): number {
  const id = nextId++;
  queue.push({ ...request, id } as DialogRequest);
  if (!active) pump();
  return id;
}

/** 关掉当前弹窗并给出结果；resolve 只允许调用一次 */
function settle(value: boolean | string | null) {
  if (!active) return;
  const request = active;
  active = null;
  try {
    (request.resolve as (v: boolean | string | null) => void)(value);
  } finally {
    pump();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore 的快照：active 引用只在弹窗进/出时变化 */
function getActive(): DialogRequest | null {
  return active;
}

export function appConfirm(message: string, options: AppConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ kind: "confirm", message, options, resolve });
  });
}

export function appPrompt(message: string, options: AppPromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({ kind: "prompt", message, options, resolve });
  });
}

/** 挂在应用根部的宿主；配合 appConfirm / appPrompt 使用 */
export function AppConfirmHost() {
  React.useSyncExternalStore(subscribe, getActive, getActive);
  const request = active;
  return (
    <Modal
      isOpen={request !== null}
      onOpenChange={(open) => {
        // Radix 在 Esc / 点遮罩时把 open 置 false —— 等价于用户点「取消」
        if (!open && request) settle(request.kind === "confirm" ? false : null);
      }}
    >
      {request ? <DialogBody key={request.id} request={request} /> : null}
    </Modal>
  );
}

function DialogBody({ request }: { request: DialogRequest }) {
  const isDanger = request.options.danger === true;
  const [input, setInput] = React.useState("");
  const submit = () => {
    settle(request.kind === "confirm" ? true : input);
  };

  return (
    <Modal.Backdrop>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={request.options.title ?? "请确认"}>
          <Modal.Header>
            <Modal.Heading>{request.options.title ?? "请确认"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-sm leading-relaxed opacity-80">{request.message}</p>
            {request.kind === "prompt" ? (
              <input
                autoFocus
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={request.options.placeholder ?? ""}
                className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/25 dark:border-white/15 dark:focus:border-white/35"
              />
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onPress={() => settle(request.kind === "confirm" ? false : null)}>
              {request.options.cancelLabel ?? "取消"}
            </Button>
            <Button variant={isDanger ? "danger" : "primary"} onPress={submit}>
              {request.options.confirmLabel ?? "确认"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
