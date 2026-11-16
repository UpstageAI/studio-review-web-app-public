import React from "react";

export interface BaseLogoProps {
  source: React.ElementType;
  className?: string;
  size?: number;
  onClick?: () => void;
}

export function BaseIcon({
  source,
  className = "",
  size = 16,
  onClick = undefined,
}: BaseLogoProps) {
  if (!onClick) {
    return React.createElement(source, {
      className,
      width: size,
      height: size,
    });
  }
  return React.createElement(source, {
    className,
    width: size,
    height: size,
    onClick,
  });
}
