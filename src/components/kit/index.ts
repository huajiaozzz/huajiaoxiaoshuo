/**
 * 项目自有的基础控件（原 HeroUI 的替代品）。
 *
 * 迁移期**保持 API 兼容**：91 个调用点只需把 `from "@heroui/react"` 换成
 * `from "@/components/kit"`，其余代码不动。组件名与子组件组合（Modal.Backdrop /
 * Tooltip.Trigger / Switch.Content …）、props 名（onPress / isPending / isSelected …）
 * 都沿用原版。
 *
 * 分层：
 *   外观规格 → src/styles/kit 下的 css（原 @heroui/styles 的裁剪搬运版）
 *   行为/动画 → Animate UI 原语（Radix Dialog、动画 Tooltip、motion Button）
 * 两者解耦，想换皮改 CSS、想换手感改组件，互不牵连。
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./button";
export { Card, type CardProps } from "./card";
export { Chip, type ChipProps } from "./chip";
export { Spinner, type SpinnerProps } from "./spinner";
export { Switch, type SwitchProps } from "./switch";
export { Tooltip, type TooltipProps } from "./tooltip";
export { Modal, type ModalProps } from "./modal";
export {
  TextField,
  Label,
  Input,
  TextArea,
  Description,
  type TextFieldProps,
  type InputProps,
  type TextAreaProps,
} from "./fields";
