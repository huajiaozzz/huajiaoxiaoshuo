import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/animate-ui/primitives/radix/dialog";

/**
 * 弹窗 —— 原 HeroUI Modal 的替代，组合结构与调用方式完全一致：
 *
 *   <Modal isOpen={open} onOpenChange={setOpen}>
 *     <Modal.Backdrop>
 *       <Modal.Container size="lg" scroll="inside">
 *         <Modal.Dialog>
 *           <Modal.Header><Modal.Heading>标题</Modal.Heading></Modal.Header>
 *           <Modal.Body>…</Modal.Body>
 *           <Modal.Footer>…</Modal.Footer>
 *         </Modal.Dialog>
 *       </Modal.Container>
 *     </Modal.Backdrop>
 *   </Modal>
 *
 * 行为层换成 Animate UI 的 Radix Dialog（自带遮罩 blur 淡入、面板翻转入场与
 * 退场），外观仍是 `.modal__*` 那套类名。size / scroll / variant 的类名映射与
 * 原版 tailwind-variants 配置一致（例如 size="lg" → `.modal__dialog--lg`，
 * scroll="inside" → `.modal__dialog--scroll-inside` + `.modal__body--scroll-inside`）。
 */
type ModalSize = "xs" | "sm" | "md" | "lg" | "full" | "cover";
type ModalScroll = "inside" | "outside";
type ModalVariant = "blur" | "opaque" | "transparent";
/** 垂直落位；居中靠 `.modal__dialog[data-placement] { my-auto }`，不打这个属性弹窗会贴顶 */
type ModalPlacement = "auto" | "top" | "center" | "bottom";

type ModalContextValue = {
  size: ModalSize;
  scroll: ModalScroll;
  placement: ModalPlacement;
  isDismissable: boolean;
};

const ModalContext = React.createContext<ModalContextValue>({
  size: "md",
  scroll: "inside",
  placement: "auto",
  isDismissable: true,
});

/**
 * 视口高度（px 字符串），写进 `--visual-viewport-height`。
 *
 * modal.css 的布局链完全建立在这个变量上：遮罩/容器的高度、
 * `.modal__dialog--scroll-inside` 的 `max-h-full` —— 没有它，弹窗拿不到高度上限，
 * 内容一多就撑出屏幕且 Body 无法滚动（原版由 React Aria 写在遮罩上）。
 * 用 visualViewport 而不是 window.innerHeight：手机上键盘弹出时它会变小，
 * 弹窗才不会被键盘顶出屏幕。
 */
function useVisualViewportHeight(): string {
  const [height, setHeight] = React.useState(() =>
    typeof window === "undefined"
      ? 0
      : (window.visualViewport?.height ?? window.innerHeight),
  );
  React.useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setHeight(vv?.height ?? window.innerHeight);
    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return height + "px";
}

export type ModalProps = {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

function ModalRoot({ isOpen, onOpenChange, children }: ModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>{children}</Dialog>
  );
}

function ModalBackdrop({
  children,
  className,
  variant = "opaque",
  isDismissable = true,
}: {
  children?: React.ReactNode;
  className?: string;
  variant?: ModalVariant;
  /** 点遮罩 / 按 Esc 是否关闭，默认 true（原版 isDismissable） */
  isDismissable?: boolean;
}) {
  const viewportHeight = useVisualViewportHeight();
  return (
    <ModalContext.Provider
      value={{ size: "md", scroll: "inside", placement: "auto", isDismissable }}
    >
      <DialogPortal>
        <DialogOverlay
          style={
            { "--visual-viewport-height": viewportHeight } as React.CSSProperties
          }
          className={cn("modal__backdrop", `modal__backdrop--${variant}`, className)}
        >
          {children}
        </DialogOverlay>
      </DialogPortal>
    </ModalContext.Provider>
  );
}

function ModalContainer({
  children,
  className,
  size,
  scroll,
  placement,
}: {
  children?: React.ReactNode;
  className?: string;
  size?: ModalSize;
  scroll?: ModalScroll;
  placement?: ModalPlacement;
}) {
  const ctx = React.use(ModalContext);
  const next: ModalContextValue = {
    ...ctx,
    size: size ?? ctx.size,
    scroll: scroll ?? ctx.scroll,
    placement: placement ?? ctx.placement,
  };
  return (
    <ModalContext.Provider value={next}>
      <div
        className={cn(
          "modal__container",
          next.size === "full" && "modal__container--full",
          next.scroll === "outside" && "modal__container--scroll-outside",
          className,
        )}
      >
        {children}
      </div>
    </ModalContext.Provider>
  );
}

function ModalDialog({
  children,
  className,
  placement,
  ...props
}: React.ComponentProps<typeof DialogContent> & { placement?: ModalPlacement }) {
  const ctx = React.use(ModalContext);
  return (
    <DialogContent
      aria-describedby={undefined}
      data-placement={placement ?? ctx.placement}
      onInteractOutside={ctx.isDismissable ? undefined : (e) => e.preventDefault()}
      onEscapeKeyDown={ctx.isDismissable ? undefined : (e) => e.preventDefault()}
      className={cn(
        "modal__dialog",
        `modal__dialog--${ctx.size}`,
        `modal__dialog--scroll-${ctx.scroll}`,
        className,
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

function ModalHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("modal__header", className)} {...props} />;
}

function ModalHeading({ className, children, ...props }: React.ComponentProps<"h2">) {
  return (
    <DialogTitle asChild>
      <h2 className={cn("modal__heading", className)} {...props}>
        {children}
      </h2>
    </DialogTitle>
  );
}

function ModalBody({ className, ...props }: React.ComponentProps<"div">) {
  const ctx = React.use(ModalContext);
  return (
    <div
      className={cn("modal__body", `modal__body--scroll-${ctx.scroll}`, className)}
      {...props}
    />
  );
}

function ModalFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("modal__footer", className)} {...props} />;
}

function ModalCloseTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DialogClose>) {
  return (
    <DialogClose
      className={cn("modal__close-trigger", className)}
      {...props}
    />
  );
}

export const Modal = Object.assign(ModalRoot, {
  Backdrop: ModalBackdrop,
  Container: ModalContainer,
  Dialog: ModalDialog,
  Header: ModalHeader,
  Heading: ModalHeading,
  Body: ModalBody,
  Footer: ModalFooter,
  CloseTrigger: ModalCloseTrigger,
});
