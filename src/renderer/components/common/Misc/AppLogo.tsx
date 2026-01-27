import './AppLogo.css';

interface AppLogoProps {
  size?: string;
}

const AppLogo = (props: AppLogoProps) => {
  const size = () => props.size || '1em';
  return <img src="assets/icons/logo.png" alt="mLearn Logo" class="app-logo" style={{ width: size(), height: size() }} />;
};

export default AppLogo;
