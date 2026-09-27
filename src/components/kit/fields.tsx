import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 表单字段组 —— 原 HeroUI TextField / Label / Input / TextArea / Description 的替代。
 *
 * 组合方式与原版一致：`TextField` 持有 value/onChange，通过 context 下发给内部的
 * `Input`/`TextArea`，所以调用点写起来还是
 *   `<TextField value={v} onChange={setV}><Label>…</Label><Input placeholder="…" /></TextField>`
 * 而不必把 value 传两遍。
 *
 * 宽度：`.textfield` 是 flex-col，子元素默认 stretch 就是全宽（原版同款布局）。
 */
type FieldContextValue = { value: string; onChange: (value: string) => void };
const FieldContext = React.createContext<FieldContextValue | null>(null);

export type TextFieldProps = Omit<
  React.ComponentProps<"div">,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  fullWidth?: boolean;
};

export function TextField({
  value,
  onChange,
  fullWidth,
  className,
  children,
  ...props
}: TextFieldProps) {
  const ctx = React.useMemo(() => ({ value, onChange }), [value, onChange]);
  return (
    <FieldContext.Provider value={ctx}>
      <div
        data-slot="textfield"
        className={cn("textfield", fullWidth && "textfield--full-width", className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label data-slot="label" className={cn("label", className)} {...props} />
  );
}

export type InputProps = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  /** 不给则跟随所在 TextField 的值 */
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export function Input({ className, value, onChange, ...props }: InputProps) {
  const ctx = React.use(FieldContext);
  return (
    <input
      data-slot="input"
      className={cn("input", "input--primary", className)}
      value={ctx ? ctx.value : value}
      onChange={(e) => {
        ctx?.onChange(e.target.value);
        onChange?.(e);
      }}
      {...props}
    />
  );
}

export type TextAreaProps = Omit<React.ComponentProps<"textarea">, "value" | "onChange"> & {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
};

export function TextArea({ className, value, onChange, ...props }: TextAreaProps) {
  const ctx = React.use(FieldContext);
  return (
    <textarea
      data-slot="textarea"
      className={cn("textarea", "textarea--primary", className)}
      value={ctx ? ctx.value : value}
      onChange={(e) => {
        ctx?.onChange(e.target.value);
        onChange?.(e);
      }}
      {...props}
    />
  );
}

export function Description({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="description"
      className={cn("description", className)}
      {...props}
    />
  );
}
