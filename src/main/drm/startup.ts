export interface DrmCommandLine {
  hasSwitch(name: string): boolean;
  getSwitchValue(name: string): string;
  appendSwitch(name: string, value?: string): void;
}
/** Runs independently of performance flags, before ready. 0 disables all library CDM interfaces. */
export function applyDrmLaunchSwitches(line: DrmCommandLine, enabled: boolean): boolean {
  if (!enabled) {
    line.appendSwitch('disable-component-update');
    line.appendSwitch('override-enabled-cdm-interface-version', '0');
    return false;
  }
  return line.hasSwitch('disable-component-update') || line.hasSwitch('override-enabled-cdm-interface-version');
}
