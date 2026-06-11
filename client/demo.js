// Demo mode — fictional dataset for screenshots and onboarding.
// Returns a plain state snapshot; caller merges it into state and calls rebuildDayIndex().

export function getDemoData(loadTempo) {
  const DAY  = '2026-05-11';
  const DAY2 = '2026-05-08';
  const DAY3 = '2026-05-07';
  const DAY4 = '2026-05-13';

  const events = {
    github: [
      // Selected day
      { id: 'gh1',  time: `${DAY}T08:15:00+02:00`, source: 'github', kind: 'branch-created', title: 'feature/push-notifications',                      repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/push-notifications' },
      { id: 'gh1b', time: `${DAY}T08:20:00+02:00`, source: 'github', kind: 'commit',          title: 'FTL-901 Scaffold push notification service',       repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/push-notifications' },
      { id: 'gh1c', time: `${DAY}T08:28:00+02:00`, source: 'github', kind: 'commit',          title: 'FTL-901 Register FCM token on login',              repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/push-notifications' },
      { id: 'gh2',  time: `${DAY}T08:45:00+02:00`, source: 'github', kind: 'commit',          title: 'Fix login timeout on expired session',             repoOrChannel: 'futured/mobile-app', url: '#', branch: 'fix/login-timeout' },
      { id: 'gh3',  time: `${DAY}T09:20:00+02:00`, source: 'github', kind: 'commit',          title: 'FTL-892 Add biometric authentication',             repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/biometric' },
      { id: 'gh4',  time: `${DAY}T09:20:00+02:00`, source: 'github', kind: 'commit',          title: 'FTL-892 Add Face ID fallback handler',             repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/biometric' },
      { id: 'gh5',  time: `${DAY}T10:15:00+02:00`, source: 'github', kind: 'pr-opened',       title: 'FTL-892 Biometric auth — initial implementation',  repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/biometric' },
      { id: 'gh6',  time: `${DAY}T11:30:00+02:00`, source: 'github', kind: 'pr-reviewed',     title: 'FTW-234 Update REST API client',                   repoOrChannel: 'futured/backend',    url: '#' },
      { id: 'gh7',  time: `${DAY}T14:10:00+02:00`, source: 'github', kind: 'commit',          title: 'FTL-892 Add unit tests for biometric module',      repoOrChannel: 'futured/mobile-app', url: '#', branch: 'feature/biometric' },
      // Other days (calendar dots)
      { id: 'gh8',  time: `${DAY2}T09:30:00+02:00`, source: 'github', kind: 'commit',         title: 'FTL-892 Skeleton & navigation wiring',             repoOrChannel: 'futured/mobile-app', url: '#' },
      { id: 'gh9',  time: `${DAY2}T11:00:00+02:00`, source: 'github', kind: 'commit',         title: 'FTW-234 Refactor network layer',                   repoOrChannel: 'futured/backend',    url: '#' },
      { id: 'gh10', time: `${DAY3}T10:00:00+02:00`, source: 'github', kind: 'commit',         title: 'FTL-780 Meeting notes in Notion',                  repoOrChannel: 'futured/mobile-app', url: '#' },
      { id: 'gh11', time: `${DAY4}T09:00:00+02:00`, source: 'github', kind: 'commit',         title: 'FTL-892 Fix flaky keychain test',                  repoOrChannel: 'futured/mobile-app', url: '#' },
    ],
    slack: [
      { id: 'sl1',  time: `${DAY}T09:05:00+02:00`,  source: 'slack', kind: 'message', title: 'Updated the PR with review feedback, LGTM now',         repoOrChannel: 'android-team', url: '#' },
      // Grouped discussion ~10:05
      { id: 'sl6',  time: `${DAY}T10:05:00+02:00`,  source: 'slack', kind: 'message', title: 'Anyone else seeing the flaky test in CI?',               repoOrChannel: 'android-team', url: '#' },
      { id: 'sl7',  time: `${DAY}T10:08:00+02:00`,  source: 'slack', kind: 'message', title: 'Yes, started failing after yesterday\'s merge',           repoOrChannel: 'android-team', url: '#' },
      { id: 'sl8',  time: `${DAY}T10:11:00+02:00`,  source: 'slack', kind: 'message', title: 'Timing issue in the keychain mock, I\'ll fix it',         repoOrChannel: 'android-team', url: '#' },
      { id: 'sl2',  time: `${DAY}T11:45:00+02:00`,  source: 'slack', kind: 'dm',      title: 'Sure, I can review that today after standup',             repoOrChannel: 'Jan Novák',    url: '#' },
      // Grouped DM ~12:50
      { id: 'sl9',  time: `${DAY}T12:50:00+02:00`,  source: 'slack', kind: 'dm',      title: 'Blocked on push notifications, can you share the specs?', repoOrChannel: 'Tomáš Procházka', url: '#' },
      { id: 'sl10', time: `${DAY}T12:53:00+02:00`,  source: 'slack', kind: 'dm',      title: 'Sure, adding you to the Figma file now',                  repoOrChannel: 'Tomáš Procházka', url: '#' },
      { id: 'sl3',  time: `${DAY}T15:30:00+02:00`,  source: 'slack', kind: 'message', title: 'FTL-892 is ready for QA 🎉',                              repoOrChannel: 'android-team', url: '#' },
      { id: 'sl4',  time: `${DAY2}T10:00:00+02:00`, source: 'slack', kind: 'message', title: 'Can someone review the API PR today?',                    repoOrChannel: 'android-team', url: '#' },
      { id: 'sl5',  time: `${DAY3}T14:00:00+02:00`, source: 'slack', kind: 'message', title: 'Tech circle topics for Monday?',                          repoOrChannel: 'android-team', url: '#' },
    ],
    calendar: [
      { id: 'cal1', time: `${DAY}T09:30:00+02:00`, source: 'calendar', kind: 'event',           title: 'Daily standup',       duration: 1800, repoOrChannel: 'David Novák',     url: '#' },
      { id: 'cal2', time: `${DAY}T13:00:00+02:00`, source: 'calendar', kind: 'event-tentative',  title: 'FTL Design review',   duration: 3600, repoOrChannel: 'Tomáš Procházka', url: '#' },
      { id: 'cal3', time: `${DAY}T16:00:00+02:00`, source: 'calendar', kind: 'event',            title: 'Android tech circle', duration: 3600, repoOrChannel: 'Adam Peterka',    url: '#' },
    ],
    email: [
      { id: 'em1', time: `${DAY}T14:35:00+02:00`, source: 'email', kind: 'email-sent', title: 'Re: Sprint review — agenda & demo slots', repoOrChannel: 'team@futured.app', url: '#' },
    ],
  };

  const worklogs = [
    { id: 'wl1', issueKey: 'FTL-892', summary: 'Biometric authentication',  timeSpentSeconds: 7200,  startDate: DAY,  startTime: '09:00:00', description: 'Biometric auth implementation' },
    { id: 'wl2', issueKey: 'FTW-234', summary: 'Update REST API client',    timeSpentSeconds: 3600,  startDate: DAY,  startTime: '11:30:00', description: 'Code review' },
    { id: 'wl3', issueKey: 'FTL-892', summary: 'Biometric authentication',  timeSpentSeconds: 14400, startDate: DAY2, startTime: '09:00:00', description: 'Skeleton & navigation' },
    { id: 'wl4', issueKey: 'FTW-100', summary: 'API maintenance',           timeSpentSeconds: 7200,  startDate: DAY2, startTime: '14:00:00', description: 'Dependency updates' },
    { id: 'wl5', issueKey: 'FTL-780', summary: 'Tech circle preparation',   timeSpentSeconds: 3600,  startDate: DAY3, startTime: '16:00:00', description: 'Tech circle' },
  ];

  const drafts = loadTempo();
  if (!drafts[DAY] || !drafts[DAY].length) {
    drafts[DAY] = [{
      id:          'demo-draft1',
      issueKey:    'FTL-780',
      timeSeconds: 3600,
      description: 'Android tech circle',
      startTime:   '16:00:00',
      sourceIds:   ['cal3'],
    }];
  }

  return {
    year: 2026, month: 5, selected: DAY,
    health: {
      ok: true,
      config: { github: true, slack: true, jira: true, tempo: true, google: true },
      googleConnected: true,
      githubUsername: 'david.kocnar',
    },
    mappings: [
      { type: 'github', key: 'futured/mobile-app', project: 'FTL' },
      { type: 'github', key: 'futured/backend',    project: 'FTW' },
      { type: 'slack',  key: 'android-team',       project: 'FTL' },
    ],
    favorites: [
      { issueKey: 'FTL-892', description: 'Biometric authentication' },
      { issueKey: 'FTW-234', description: 'API client update' },
      { issueKey: 'FTL-780', description: 'Tech circle prep' },
    ],
    events,
    worklogs,
    tempoByDay: drafts,
  };
}
