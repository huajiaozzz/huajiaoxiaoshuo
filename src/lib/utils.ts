import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn / Animate UI 组件通用的 className 合并函数。
 *
 * clsx 负责条件拼接，tailwind-merge 负责"后面的 Tailwind 类覆盖前面的"，
 * 这样组件写 `cn("rounded-md", className)` 时调用方还能改样式。
 *
 * 项目自己的代码仍可继续用字符串拼接 —— 只有注册表组件依赖这个约定路径
 * （components.json 的 `aliases.utils` → `@/lib/utils`）。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
