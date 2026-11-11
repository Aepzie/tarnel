import type { DrmStatus } from '@shared/drm';

export interface DrmPresentation {
  kind: 'saving' | 'restart' | 'unavailable' | 'available' | 'disabled' | 'loading';
  title: string;
  description: string;
  canRestart: boolean;
}

/** Keep an optimistic switch change from displaying a stale success or restart action. */
export function drmPresentation(status: DrmStatus, selectedEnabled: boolean): DrmPresentation {
  if (status.enabled !== selectedEnabled) {
    return { kind: 'saving', title: 'Einstellung wird gespeichert …', description: 'Der DRM-Status wird aktualisiert.', canRestart: false };
  }
  if (status.enabled && (status.failure === 'runtime-missing' || status.state === 'unsupported')) {
    return {
      kind: 'unavailable',
      title: 'Nicht verfügbar',
      description: 'Diese Vela-Version enthält keine unterstützte DRM-Laufzeit. Einschalten allein ermöglicht keine geschützte Wiedergabe.',
      canRestart: false,
    };
  }
  if (status.restartRequired || status.state === 'restart-required') {
    return {
      kind: 'restart',
      title: 'Neustart erforderlich',
      description: status.enabled
        ? 'Starte Vela neu, um DRM zu aktivieren und die Verfügbarkeit zu prüfen.'
        : 'Die Änderung wird nach einem Neustart wirksam. Geschützte Inhalte können bis dahin weiterhin verwendet werden.',
      canRestart: true,
    };
  }
  if (status.state === 'disabled') {
    return {
      kind: 'disabled',
      title: 'Deaktiviert',
      description: 'Widevine-Wiedergabe ist deaktiviert. Normale HTML5-Videos bleiben nutzbar.',
      canRestart: false,
    };
  }
  if (status.state === 'initializing') {
    return {
      kind: 'loading',
      title: 'DRM wird vorbereitet …',
      description: 'Die Wiedergabekomponente wird geladen und geprüft. Dies kann einen Moment dauern.',
      canRestart: false,
    };
  }
  if (status.state === 'available') {
    return {
      kind: 'available',
      title: 'DRM-Komponente verfügbar',
      description: 'Die lokale DRM-Prüfung war erfolgreich. Lade bereits geöffnete Streamingseiten neu. Netflix-Wiedergabe ist nicht verifiziert; einzelne Dienste können Vela weiterhin ablehnen.',
      canRestart: false,
    };
  }
  const description = status.failure === 'component-timeout'
    ? 'Die Wiedergabekomponente wurde nicht rechtzeitig bereit. Prüfe deine Verbindung und starte Vela bei Bedarf neu.'
    : status.failure === 'component-failed'
      ? 'Die Wiedergabekomponente konnte nicht geladen werden. Geschützte Wiedergabe ist derzeit nicht verfügbar.'
      : status.failure === 'startup-blocked'
        ? 'DRM wurde bei diesem Start gesperrt. Starte Vela neu, um die Aktivierung erneut zu prüfen.'
        : 'Die Wiedergabekomponente konnte geschützte Wiedergabe nicht bereitstellen. DRM ist derzeit nicht verfügbar.';
  return { kind: 'unavailable', title: 'Nicht verfügbar', description, canRestart: status.failure === 'startup-blocked' };
}
