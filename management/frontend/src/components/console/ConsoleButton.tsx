import { Button, type ButtonProps } from "@heroui/react";
import { forwardRef, type ComponentRef, type ReactNode } from "react";

export const ConsoleButton = forwardRef<ComponentRef<typeof Button>, ButtonProps & { children: ReactNode }>(function ConsoleButton({ children, ...props }, ref) {
  return <Button {...props} ref={ref}>{children}</Button>;
});
