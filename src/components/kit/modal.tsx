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

type ModalContextValue = {
  size: ModalSize;
  scroll: ModalScroll;
  isDismissable: boolean;
};

const ModalContext = React.createContext<ModalContextValue>({
  size: "md",
  scroll: "inside",
  isDismissable: true,
});

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
  return (
    <ModalContext.Provider value={{ size: "md", scroll: "inside", isDismissable }}>
      <DialogPortal>
        <DialogOverlay
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
}: {
  children?: React.ReactNode;
  className?: string;
  size?: ModalSize;
  scroll?: ModalScroll;
}) {
  const ctx = React.use(ModalContext);
  const next: ModalContextValue = {
    ...ctx,
    size: size ?? ctx.size,
    scroll: scroll ?? ctx.scroll,
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
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const ctx = React.use(ModalContext);
  return (
    <DialogContent
      aria-describedby={undefined}
      onInteractOutside={ctx.isDismissable ? undefined : (e) => e.preventDefault()}
      onEscapeKeyDown={ctx.isDismissable ? undefined : (e) => e.preventDefault()}
      className={cn(
        "modal__dialog",
        `modal__dialog--${ctx.size}`,
        `modal__dialog--${ctx.scroll}`,
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
      className={cn("modal__body", `modal__body--${ctx.scroll}`, className)}
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
