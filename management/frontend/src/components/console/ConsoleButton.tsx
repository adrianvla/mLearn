import { Button, type ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";

export function ConsoleButton({ children, ...props }: ButtonProps & { children: ReactNode }) {
  return <Button {...props}>{children}</Button>;
}
