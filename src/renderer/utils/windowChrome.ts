export interface WindowControlsEnvironment {
  isElectron: boolean;
  isMacOS: boolean;
  /** True when renderer content occupies the native titlebar area. */
  contentOverlapsNativeControls: boolean;
}

export interface WindowControlsInsets {
  inlineStart: string;
  blockStart: string;
}

const NO_WINDOW_CONTROLS_INSET: WindowControlsInsets = {
  inlineStart: '0px',
  blockStart: '0px',
};

const MACOS_TRAFFIC_LIGHTS_INSET: WindowControlsInsets = {
  inlineStart: '100px',
  blockStart: '28px',
};

/**
 * Returns the portion of renderer content obscured by native window controls.
 * Only frameless macOS Electron windows overlay traffic lights on renderer
 * content; native Windows/Linux titlebars and mobile/web views do not.
 */
export function getWindowControlsInsets(environment: WindowControlsEnvironment): WindowControlsInsets {
  const trafficLightsObstructContent = environment.isElectron
    && environment.isMacOS
    && environment.contentOverlapsNativeControls;

  return trafficLightsObstructContent ? MACOS_TRAFFIC_LIGHTS_INSET : NO_WINDOW_CONTROLS_INSET;
}
