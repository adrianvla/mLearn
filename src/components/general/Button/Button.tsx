import { JSX } from 'solid-js';
import styles from './Button.module.css';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  children: JSX.Element;
}

const Button = (props: ButtonProps) => {
  const mergedClassList = {
    [styles.button]: true,
    ...(props.classList as Record<string, boolean> | undefined)
  };

  return (
      <button {...props} classList={mergedClassList}>
        {props.children}
      </button>
  );
};

export default Button;
