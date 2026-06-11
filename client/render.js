// Callback registry to break circular imports.
// Boot fills these in before user interaction.

const _notReady = (name) => () => { throw new Error(`render.${name} called before boot()`); };
const _notReadyA = (name) => () => { throw new Error(`actions.${name} called before boot()`); };

export const render = {
  day:           _notReady('day'),
  tempo:         _notReady('tempo'),
  calendar:      _notReady('calendar'),
  weeklySummary: _notReady('weeklySummary'),
  statusPill:    _notReady('statusPill'),
  favorites:     _notReady('favorites'),
};

export const actions = {
  selectDay:             _notReadyA('selectDay'),
  toast:                 _notReadyA('toast'),
  addEventToTempo:       _notReadyA('addEventToTempo'),
  addMeetingToTempo:     _notReadyA('addMeetingToTempo'),
  addCompactGroupToTempo:_notReadyA('addCompactGroupToTempo'),
  loadWorklogs:          _notReadyA('loadWorklogs'),
  loadHealth:            _notReadyA('loadHealth'),
  oauthNavigate:         _notReadyA('oauthNavigate'),
  saveMappings:          _notReadyA('saveMappings'),
};
