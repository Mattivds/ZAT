'use client';

import { useEffect, useMemo, useState } from 'react';
import { addWeeks, format } from 'date-fns';
import { nl } from 'date-fns/locale';

/* =========================
   Types
========================= */
interface Reservation {
  date: string; // yyyy-MM-dd
  timeSlot: string; // '18u30-19u30'
  court: number; // 1..3
  matchType: 'single' | 'double';
  players: string[]; // single: [a,b], double: [x1,x2,y1,y2]
  origin?: 'challenge' | 'training'; // label op court
  challengeId?: string; // link naar uitdaging
  result?: { winner: string; loser: string }; // uitslag (alleen bij singles)
}

type Availability = Record<string, Record<string, Record<string, boolean>>>;

interface UserAccount {
  playerName: string;
  passwordHash: string; // demo hash (niet veilig)
  email?: string;
}

type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'completed';

interface Challenge {
  id: string;
  from: string; // playerName
  to: string; // playerName
  date: string; // yyyy-MM-dd
  slot: string; // timeslot id
  status: ChallengeStatus;
  createdAt: number;
  result?: { winner: string; loser: string };
}

type NotificationType =
  | 'challenge'
  | 'challenge-sent'
  | 'challenge-accepted'
  | 'challenge-declined'
  | 'match-reminder'
  | 'match-result';

interface Notification {
  id: string;
  to: string; // playerName
  type: NotificationType;
  payload: any;
  read: boolean;
  createdAt: number;
}

/* =========================
   Data
========================= */
const PLAYER_SCORES: Record<string, number> = {
  Mattias: 55,
  Ruben: 70,
  Seppe: 55,
  Tibo: 60,
  Aaron: 50,
  Koenraad: 10,
  Brent: 5,
  Nicolas: 15,
  Remi: 20,
  SanderD: 25,
  Gilles: 10,
  Thomas: 35,
  Wout: 20,
  SanderB: 75,
};
const PLAYERS = Object.keys(PLAYER_SCORES);

const TIME_SLOTS = [
  { id: '18u30-19u30', label: '18u30-19u30' },
  { id: '19u30-20u30', label: '19u30-20u30' },
];

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const scoreOf = (name: string) => PLAYER_SCORES[name] ?? 0;

// VERVANG deze helper (geen generator meer)
// bouwt alle 4-tallen als array, werkt met elke TS target
function combinations4<T>(arr: T[]): Array<[T, T, T, T]> {
  const res: Array<[T, T, T, T]> = [];
  const n = arr.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          res.push([arr[i], arr[j], arr[k], arr[l]]);
        }
      }
    }
  }
  return res;
}


/* =========================
   Tennis net visual
========================= */
const TennisNet = () => (
  <div className="relative w-full h-8 my-1" aria-hidden>
    <div className="absolute top-0 left-0 right-0 h-1 bg-white rounded-sm" />
    <div
      className="absolute left-0 right-0 bottom-0"
      style={{
        top: '0.5rem',
        backgroundSize: '6px 6px',
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.45) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(255,255,255,0.45) 1px, transparent 1px)',
      }}
    />
    <div className="absolute left-0 right-0" style={{ top: '0.5rem' }}>
      <div className="border-t border-white/40" />
    </div>
  </div>
);

/* =========================
   Player chip
========================= */
const PlayerChip = ({
  name,
  size = 'md',
  highlight = false,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) => {
  const base =
    'inline-flex items-center gap-2 rounded-full bg-white shadow-sm border';
  const sizeCls =
    size === 'sm'
      ? 'text-xs px-2 py-0.5'
      : size === 'lg'
      ? 'text-base px-3 py-1.5'
      : 'text-sm px-2.5 py-1';
  const badgeCls =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5'
      : size === 'lg'
      ? 'text-xs px-2 py-0.5'
      : 'text-xs px-1.5 py-0.5';
  return (
    <div
      className={`${base} ${
        highlight ? 'border-green-400 ring-2 ring-green-300' : 'border-gray-200'
      } ${sizeCls}`}
    >
      <span className="font-semibold text-gray-900">{name}</span>
      <span className={`rounded-full bg-purple-600 text-white ${badgeCls}`}>
        {scoreOf(name)}
      </span>
    </div>
  );
};

/* =========================
   Demo auth + storage
========================= */
const USERS_KEY = 'tennis-users';
const CURRENT_KEY = 'tennis-current-user';
const NOTIFS_KEY = 'tennis-notifications';
const CHALLENGES_KEY = 'tennis-challenges';
const REMINDERS_KEY = 'tennis-reminders-sent';
const RESERV_KEY = 'tennis-reservations';
const MATCHTYPES_KEY = 'tennis-match-types';
const AVAIL_KEY = 'tennis-availability';
const SELECTED_DATE_KEY = 'tennis-selected-date';

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
};

/* ====== Vaste logins per speler ====== */
const PRESET_PASSWORDS: Record<string, string> = {
  Mattias: 'Mattias!2025',
  Ruben: 'Ruben!2025',
  Seppe: 'Seppe!2025',
  Tibo: 'Tibo!2025',
  Aaron: 'Aaron!2025',
  Koenraad: 'Koenraad!2025',
  Brent: 'Brent!2025',
  Nicolas: 'Nicolas!2025',
  Remi: 'Remi!2025',
  SanderD: 'SanderD!2025',
  Gilles: 'Gilles!2025',
  Thomas: 'Thomas!2025',
  Wout: 'Wout!2025',
  SanderB: 'SanderB!2025',
};

const canonicalPlayer = (raw: string) => {
  const name = raw.trim().toLowerCase();
  return PLAYERS.find((p) => p.toLowerCase() === name) ?? null;
};

function buildPresetUsers(): Record<string, UserAccount> {
  const map: Record<string, UserAccount> = {};
  for (const p of PLAYERS) {
    const pwd = PRESET_PASSWORDS[p] ?? 'Welkom!2025';
    map[p] = { playerName: p, passwordHash: hash(pwd) };
  }
  return map;
}

function loadUsers(): Record<string, UserAccount> {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const preset = buildPresetUsers();
    if (!raw) {
      localStorage.setItem(USERS_KEY, JSON.stringify(preset));
      return preset;
    }
    const parsed = JSON.parse(raw) as Record<string, UserAccount>;
    const cleaned: Record<string, UserAccount> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (PLAYERS.includes(k)) cleaned[k] = v;
    }
    const merged = { ...preset, ...cleaned };
    localStorage.setItem(USERS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    const preset = buildPresetUsers();
    localStorage.setItem(USERS_KEY, JSON.stringify(preset));
    return preset;
  }
}
function saveUsers(u: Record<string, UserAccount>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(u));
}
function loadCurrent(): UserAccount | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveCurrent(u: UserAccount | null) {
  if (!u) localStorage.removeItem(CURRENT_KEY);
  else localStorage.setItem(CURRENT_KEY, JSON.stringify(u));
}
function loadNotifs(): Notification[] {
  try {
    const raw = localStorage.getItem(NOTIFS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveNotifs(n: Notification[]) {
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(n));
}
function loadChallenges(): Challenge[] {
  try {
    const raw = localStorage.getItem(CHALLENGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveChallenges(c: Challenge[]) {
  localStorage.setItem(CHALLENGES_KEY, JSON.stringify(c));
}
function loadRemindersSent(mapKey = REMINDERS_KEY): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(mapKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveRemindersSent(map: Record<string, boolean>) {
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(map));
}

/* =========================
   Page
========================= */
export default function Page() {
  /* --- Core state --- */
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<
    Record<string, string[]>
  >({});
  const [matchTypes, setMatchTypes] = useState<
    Record<string, 'single' | 'double'>
  >({});

  /* --- Auth state --- */
  const [users, setUsers] = useState<Record<string, UserAccount>>({});
  const [current, setCurrent] = useState<UserAccount | null>(null);
  const isLoggedIn = !!current;
  const myName = current?.playerName ?? null;
  const isAdmin = myName === 'Mattias';

  /* --- Tab state --- */
  const [activeTab, setActiveTab] = useState<
    'reservations' | 'availability' | 'ladder'
  >('reservations');

  /* --- Availability (per speler) --- */
  const [availability, setAvailability] = useState<Availability>({});

  /* --- Challenges + Notifications --- */
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const unreadCount = useMemo(
    () =>
      myName ? notifs.filter((n) => n.to === myName && !n.read).length : 0,
    [notifs, myName]
  );
  const [remindersSent, setRemindersSent] = useState<Record<string, boolean>>(
    {}
  );

  /* --- Dates --- */
  const startDate = new Date(2025, 8, 28);
  const sundays = useMemo(
    () => Array.from({ length: 20 }, (_, i) => addWeeks(startDate, i)),
    []
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    format(sundays[0], 'yyyy-MM-dd')
  );

  /* --- Challenge form state --- */
  const [challengeTo, setChallengeTo] = useState(PLAYERS[0]);
  const [challengeSlot, setChallengeSlot] = useState(TIME_SLOTS[0].id);
  const [challengeDate, setChallengeDate] = useState<string>(selectedDate);

  /* --- Auth modal state --- */
  const [authOpen, setAuthOpen] = useState(false);
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authErr, setAuthErr] = useState<string | null>(null);

  /* --- Load persisted --- */
  useEffect(() => {
    const savedReservations = localStorage.getItem(RESERV_KEY);
    const savedMatchTypes = localStorage.getItem(MATCHTYPES_KEY);
    const savedSelectedDate = localStorage.getItem(SELECTED_DATE_KEY);
    const savedAvailability = localStorage.getItem(AVAIL_KEY);

    if (savedReservations) {
      const parsed: Reservation[] = JSON.parse(savedReservations);
      const migrated = parsed.map((r) => ({
        ...r,
        origin: r.origin ?? (r.challengeId ? 'challenge' : 'training'),
      }));
      setReservations(migrated);
    }
    if (savedMatchTypes) setMatchTypes(JSON.parse(savedMatchTypes));
    if (savedSelectedDate) setSelectedDate(savedSelectedDate);
    if (savedAvailability) setAvailability(JSON.parse(savedAvailability));

    setUsers(loadUsers());
    setCurrent(loadCurrent());
    setNotifs(loadNotifs());
    setChallenges(loadChallenges());
    setRemindersSent(loadRemindersSent());
  }, []);

  /* --- Persist --- */
  useEffect(() => {
    localStorage.setItem(RESERV_KEY, JSON.stringify(reservations));
  }, [reservations]);
  useEffect(() => {
    localStorage.setItem(MATCHTYPES_KEY, JSON.stringify(matchTypes));
  }, [matchTypes]);
  useEffect(() => {
    localStorage.setItem(SELECTED_DATE_KEY, selectedDate);
  }, [selectedDate]);
  useEffect(() => {
    localStorage.setItem(AVAIL_KEY, JSON.stringify(availability));
  }, [availability]);
  useEffect(() => {
    saveNotifs(notifs);
  }, [notifs]);
  useEffect(() => {
    saveChallenges(challenges);
  }, [challenges]);
  useEffect(() => {
    saveRemindersSent(remindersSent);
  }, [remindersSent]);

  /* --- Cross-tab sync --- */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      try {
        if (e.key === NOTIFS_KEY && e.newValue)
          setNotifs(JSON.parse(e.newValue));
        if (e.key === CHALLENGES_KEY && e.newValue)
          setChallenges(JSON.parse(e.newValue));
        if (e.key === RESERV_KEY && e.newValue)
          setReservations(JSON.parse(e.newValue));
        if (e.key === MATCHTYPES_KEY && e.newValue)
          setMatchTypes(JSON.parse(e.newValue));
        if (e.key === AVAIL_KEY && e.newValue)
          setAvailability(JSON.parse(e.newValue));
        if (e.key === SELECTED_DATE_KEY && e.newValue)
          setSelectedDate(e.newValue);
      } catch {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* --- Helpers --- */
  const getCourtKey = (date: string, timeSlot: string, court: number) =>
    `${date}-${timeSlot}-${court}`;
  const getMatchType = (date: string, timeSlot: string, court: number) =>
    matchTypes[getCourtKey(date, timeSlot, court)] || 'single';

  const canModifyReservation = (r: Reservation) =>
    isAdmin || (!!myName && r.players.includes(myName));

  const setMatchTypeFor = (
    date: string,
    timeSlot: string,
    court: number,
    type: 'single' | 'double'
  ) => {
    const key = getCourtKey(date, timeSlot, court);
    setMatchTypes((prev) => ({ ...prev, [key]: type }));
    setSelectedPlayers((prev) => ({ ...prev, [key]: [] }));
  };

  const playersAvailableFor = (date: string, slot: string) => {
    const availForDate = availability[date] || {};
    const availForSlot = availForDate[slot] || {};
    return PLAYERS.filter((p) => availForSlot[p] !== false);
  };

  const getPlayersInSlot = (date: string, timeSlot: string) => {
    const set = new Set<string>();
    reservations.forEach((r) => {
      if (r.date === date && r.timeSlot === timeSlot)
        r.players.forEach((p) => set.add(p));
    });
    return set;
  };

  /* --- Auth actions --- */
  const resetAllUsers = () => {
    const ok = window.confirm(
      'Vaste logins opnieuw instellen? Dit logt iedereen uit.'
    );
    if (!ok) return;
    const preset = buildPresetUsers();
    saveUsers(preset);
    setUsers(preset);
    saveCurrent(null);
    setCurrent(null);
  };

  const loginUser = (playerRaw: string, password: string) => {
    const player = canonicalPlayer(playerRaw);
    if (!player) throw new Error('Onbekende spelersnaam.');
    const all = loadUsers();
    const acc = all[player];
    if (!acc) throw new Error('Account ontbreekt voor deze speler.');
    if (acc.passwordHash !== hash(password))
      throw new Error('Onjuist wachtwoord.');
    saveCurrent(acc);
    setCurrent(acc);
  };

  const logoutUser = () => {
    saveCurrent(null);
    setCurrent(null);
  };

  const submitAuth = () => {
    try {
      setAuthErr(null);
      loginUser(authUser, authPass);
      setAuthOpen(false);
      setAuthUser('');
      setAuthPass('');
    } catch (e: any) {
      setAuthErr(e?.message || 'Er ging iets mis.');
    }
  };

  /* --- Notifications helpers (DIRECT persist) --- */

  const pushNotif = (
    n: Omit<Notification, 'id' | 'createdAt' | 'read'> & { read?: boolean }
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: Notification = {
      id,
      createdAt: Date.now(),
      read: n.read ?? false,
      to: n.to,
      type: n.type,
      payload: n.payload,
    };
    setNotifs((prev) => {
      const next = [entry, ...prev];
      try {
        localStorage.setItem(NOTIFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const markAllRead = () => {
    if (!myName) return;
    setNotifs((prev) => {
      const next = prev.map((n) =>
        n.to === myName ? { ...n, read: true } : n
      );
      try {
        localStorage.setItem(NOTIFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  /* --- Challenges helpers --- */
  const createChallenge = (to: string, date: string, slot: string) => {
    if (!myName) return alert('Je moet ingelogd zijn om uit te dagen.');
    if (to === myName) return alert('Je kan jezelf niet uitdagen.');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const c: Challenge = {
      id,
      from: myName,
      to,
      date,
      slot,
      status: 'pending' as const,
      createdAt: Date.now(),
    };
    setChallenges((prev): Challenge[] => {
      const next = [c, ...prev];
      saveChallenges(next);
      return next;
    });

    // notif naar tegenstander (ongelezen)
    pushNotif({
      to,
      type: 'challenge',
      payload: { id, from: myName, date, slot },
    });

    // notif naar verzender, direct als gelezen (geen badge)
    pushNotif({
      to: myName!,
      type: 'challenge-sent',
      payload: { id, to, date, slot },
      read: true,
    });

    alert(
      `Uitdaging verstuurd naar ${to} voor ${format(new Date(date), 'dd/MM', {
        locale: nl,
      })} ${slot}.`
    );
  };

  const acceptChallenge = (c: Challenge) => {
    const allowed = new Set(playersAvailableFor(c.date, c.slot));
    if (!allowed.has(c.from) || !allowed.has(c.to))
      return alert('Een van beide spelers is niet beschikbaar.');
    const slotPlayers = getPlayersInSlot(c.date, c.slot);
    if (slotPlayers.has(c.from) || slotPlayers.has(c.to))
      return alert('Een van beide spelers is al ingepland.');
    const court = [1, 2, 3].find(
      (ct) =>
        !reservations.some(
          (r) => r.date === c.date && r.timeSlot === c.slot && r.court === ct
        )
    );
    if (!court) return alert('Geen vrij terrein in dit uur.');

    const res: Reservation = {
      date: c.date,
      timeSlot: c.slot,
      court,
      matchType: 'single',
      players: [c.from, c.to],
      origin: 'challenge',
      challengeId: c.id,
    };
    setReservations((prev) => {
      const next = [...prev, res];
      localStorage.setItem(RESERV_KEY, JSON.stringify(next));
      return next;
    });
    setChallenges((prev): Challenge[] => {
      const next = prev.map((x): Challenge =>
        x.id === c.id ? { ...x, status: 'accepted' as const } : x
      );
      saveChallenges(next);
      return next;
    });

    pushNotif({
      to: c.from,
      type: 'challenge-accepted',
      payload: { by: c.to, date: c.date, slot: c.slot, court },
    });
    pushNotif({
      to: c.to,
      type: 'challenge-accepted',
      payload: { by: c.to, date: c.date, slot: c.slot, court },
    });
  };

  const declineChallenge = (c: Challenge) => {
    setChallenges((prev): Challenge[] => {
      const next = prev.map((x): Challenge =>
        x.id === c.id ? { ...x, status: 'declined' as const } : x
      );
      saveChallenges(next);
      return next;
    });
    pushNotif({
      to: c.from,
      type: 'challenge-declined',
      payload: { by: c.to, date: c.date, slot: c.slot },
    });
  };

  const markChallengeWinner = (c: Challenge, winner: string) => {
    if (!myName) return;
    if (!(c.from === myName || c.to === myName || isAdmin)) {
      alert('Je kan enkel uitslagen doorgeven voor je eigen wedstrijden.');
      return;
    }
    if (c.status !== 'accepted') {
      alert(
        'Je kan enkel een winnaar markeren voor een geaccepteerde uitdaging.'
      );
      return;
    }
    const loser = winner === c.from ? c.to : c.from;

    setReservations((prev) => {
      const next = prev.map((r) =>
        r.challengeId === c.id ? { ...r, result: { winner, loser } } : r
      );
      localStorage.setItem(RESERV_KEY, JSON.stringify(next));
      return next;
    });
    setChallenges((prev): Challenge[] => {
      const next = prev.map((x): Challenge =>
        x.id === c.id
          ? {
              ...x,
              status: 'completed' as const,
              result: { winner, loser },
            }
          : x
      );
      saveChallenges(next);
      return next;
    });
    pushNotif({
      to: c.from,
      type: 'match-result',
      payload: { winner, loser, date: c.date, slot: c.slot },
    });
    pushNotif({
      to: c.to,
      type: 'match-result',
      payload: { winner, loser, date: c.date, slot: c.slot },
    });
  };

  /* --- Day-of reminders (poll elke 60s) --- */
  useEffect(() => {
    const tick = () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      reservations.forEach((r) => {
        if (r.date !== today) return;
        r.players.forEach((p) => {
          const key = `${today}|${p}`;
          if (!remindersSent[key]) {
            pushNotif({
              to: p,
              type: 'match-reminder',
              payload: { date: r.date, slot: r.timeSlot, court: r.court },
            });
            setRemindersSent((prev) => {
              const next = { ...prev, [key]: true };
              saveRemindersSent(next);
              return next;
            });
          }
        });
      });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [reservations, remindersSent]);

  /* --- Reservaties --- */
  const handlePlayerSelect = (
    date: string,
    timeSlot: string,
    court: number,
    idx: number,
    player: string
  ) => {
    const key = getCourtKey(date, timeSlot, court);
    const maxPlayers = getMatchType(date, timeSlot, court) === 'single' ? 2 : 4;
    setSelectedPlayers((prev) => {
      const arr = [...(prev[key] || [])];
      while (arr.length < maxPlayers) arr.push('');
      arr[idx] = player;
      return { ...prev, [key]: arr };
    });
  };

  const handleReservation = (date: string, timeSlot: string, court: number) => {
    if (!isLoggedIn && !isAdmin) return alert('Log in om te reserveren.');
    const key = getCourtKey(date, timeSlot, court);
    const playersData = (selectedPlayers[key] || []).filter(Boolean);
    const matchType = getMatchType(date, timeSlot, court);
    const requiredPlayers = matchType === 'single' ? 2 : 4;

    if (playersData.length !== requiredPlayers) {
      alert(`Selecteer alle ${requiredPlayers} spelers voor dit terrein`);
      return;
    }
    if (!isAdmin && myName && !playersData.includes(myName)) {
      alert('Je kan enkel wedstrijden aanmaken waar je zelf in meespeelt.');
      return;
    }

    const allowed = new Set(playersAvailableFor(date, timeSlot));
    if (playersData.some((p) => !allowed.has(p)))
      return alert('Een of meer spelers zijn niet beschikbaar.');

    const slotPlayers = getPlayersInSlot(date, timeSlot);
    if (playersData.some((p) => slotPlayers.has(p)))
      return alert('Een van de gekozen spelers is al ingepland in dit uur.');

    const existing = reservations.find(
      (r) => r.date === date && r.timeSlot === timeSlot && r.court === court
    );

    if (existing) {
      if (!canModifyReservation(existing))
        return alert('Je kan enkel je eigen wedstrijden wijzigen.');
      setReservations((prev) => {
        const next = prev.map((r) =>
          r.date === date && r.timeSlot === timeSlot && r.court === court
            ? { ...r, players: playersData, matchType }
            : r
        );
        localStorage.setItem(RESERV_KEY, JSON.stringify(next));
        return next;
      });
    } else {
      setReservations((prev) => {
        const next = [
          ...prev,
          {
            date,
            timeSlot,
            court,
            matchType,
            players: playersData,
            origin: 'training' as const,
          },
        ];
        localStorage.setItem(RESERV_KEY, JSON.stringify(next));
        return next;
      });
    }

    setSelectedPlayers((prev) => ({ ...prev, [key]: [] }));
  };

  const removeReservation = (date: string, timeSlot: string, court: number) => {
    const res = reservations.find(
      (r) => r.date === date && r.timeSlot === timeSlot && r.court === court
    );
    if (!res) return;
    if (!canModifyReservation(res))
      return alert('Je kan enkel je eigen wedstrijden verwijderen.');
    const ok = window.confirm(
      'Weet je zeker dat je deze reservatie wilt verwijderen?'
    );
    if (!ok) return;
    setReservations((prev) => {
      const next = prev.filter(
        (r) =>
          !(r.date === date && r.timeSlot === timeSlot && r.court === court)
      );
      localStorage.setItem(RESERV_KEY, JSON.stringify(next));
      return next;
    });
  };

  /* --- Planner (admin) --- */
  const buildCounts = (excludingDate?: string) => {
    const opponentCount: Record<string, number> = {};
    reservations.forEach((r) => {
      if (excludingDate && r.date === excludingDate) return;
      if (r.matchType === 'single') {
        const [a, b] = r.players;
        opponentCount[pairKey(a, b)] = (opponentCount[pairKey(a, b)] || 0) + 1;
      } else {
        const [x1, x2, y1, y2] = r.players;
        [
          [x1, y1],
          [x1, y2],
          [x2, y1],
          [x2, y2],
        ].forEach(([a, b]) => {
          const k = pairKey(a, b);
          opponentCount[k] = (opponentCount[k] || 0) + 1;
        });
      }
    });
    return { opponentCount };
  };

  const planAllBalanced = () => {
    const { opponentCount } = buildCounts();
    const result: Reservation[] = [];
    const mt: Record<string, 'single' | 'double'> = {};
  
    const hours = sundays.flatMap((d) =>
      TIME_SLOTS.map((slot) => ({
        dateStr: format(d, 'yyyy-MM-dd'),
        slotId: slot.id,
      }))
    );
  
    const oppSeen = (a: string, b: string) => opponentCount[pairKey(a, b)] || 0;
  
    hours.forEach((hr, hourIdx) => {
      const groups = hourIdx % 2 === 0 ? [4, 4, 2] : [4, 2, 2];
      const used = new Set<string>();
      const available = new Set(playersAvailableFor(hr.dateStr, hr.slotId));
  
      const pickSingles = (): [string, string] | null => {
        const cand = PLAYERS.filter((p) => !used.has(p) && available.has(p));
        if (cand.length < 2) return null;
        const sorted = cand.slice().sort((a, b) => scoreOf(a) - scoreOf(b));
        let best: [string, string] | null = null;
        let bestScore = Infinity;
        for (let i = 0; i < sorted.length - 1; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i], b = sorted[j];
            const diff = Math.abs(scoreOf(a) - scoreOf(b));
            const s = diff * 12 + oppSeen(a, b) * 60 + Math.random() * 0.5;
            if (s < bestScore) {
              bestScore = s;
              best = [a, b];
            }
          }
        }
        return best;
      };
  
      const pickDoubles = (): { teamA: [string, string]; teamB: [string, string] } | null => {
        const cand = PLAYERS.filter((p) => !used.has(p) && available.has(p));
        if (cand.length < 4) return null;
        let best: { teamA: [string, string]; teamB: [string, string] } | null = null;
        let bestScore = Infinity;
  
        // >>> FIX: destructure per quad binnen de loop
        for (const [a, b, c, d] of combinations4(cand)) {
          const splits: Array<[[string, string], [string, string]]> = [
            [[a, b], [c, d]],
            [[a, c], [b, d]],
            [[a, d], [b, c]],
          ];
          for (const [t1, t2] of splits) {
            const [x1, x2] = t1, [y1, y2] = t2;
            const sumA = scoreOf(x1) + scoreOf(x2);
            const sumB = scoreOf(y1) + scoreOf(y2);
            const sumDiff = Math.abs(sumA - sumB);
            let s = 0;
            s += sumDiff * 15;
            s += oppSeen(x1, y1) + oppSeen(x1, y2) + oppSeen(x2, y1) + oppSeen(x2, y2);
            s += Math.random() * 0.5;
            if (s < bestScore) {
              bestScore = s;
              best = { teamA: [x1, x2], teamB: [y1, y2] };
            }
          }
        }
        return best;
      };
  
      groups.forEach((size, idxInHour) => {
        const court = idxInHour + 1;
        if (size === 2) {
          const pair = pickSingles();
          if (!pair) return;
          const [a, b] = pair;
          used.add(a); used.add(b);
          result.push({
            date: hr.dateStr,
            timeSlot: hr.slotId,
            court,
            matchType: 'single',
            players: [a, b],
            origin: 'training',
          });
          mt[getCourtKey(hr.dateStr, hr.slotId, court)] = 'single';
        } else {
          const grp = pickDoubles();
          if (!grp) return;
          const { teamA, teamB } = grp;
          const [x1, x2] = teamA, [y1, y2] = teamB;
          [x1, x2, y1, y2].forEach((p) => used.add(p));
          result.push({
            date: hr.dateStr,
            timeSlot: hr.slotId,
            court,
            matchType: 'double',
            players: [x1, x2, y1, y2],
            origin: 'training',
          });
          mt[getCourtKey(hr.dateStr, hr.slotId, court)] = 'double';
        }
      });
    });
  
    setReservations(result);
    setMatchTypes(mt);
  };
  

  const planSelectedWeek = () => {
    const { opponentCount } = buildCounts(selectedDate);
    setReservations((prev) => {
      const next = prev.filter((r) => r.date !== selectedDate);
      localStorage.setItem(RESERV_KEY, JSON.stringify(next));
      return next;
    });
  
    const result: Reservation[] = [];
    const mt: Record<string, 'single' | 'double'> = {};
    const hours = TIME_SLOTS.map((slot) => ({
      dateStr: selectedDate,
      slotId: slot.id,
    }));
    const oppSeen = (a: string, b: string) => opponentCount[pairKey(a, b)] || 0;
  
    hours.forEach((hr, hourIdx) => {
      const groups = hourIdx % 2 === 0 ? [4, 4, 2] : [4, 2, 2];
      const used = new Set<string>();
      const available = new Set(playersAvailableFor(hr.dateStr, hr.slotId));
  
      const pickSingles = (): [string, string] | null => {
        const cand = PLAYERS.filter((p) => !used.has(p) && available.has(p));
        if (cand.length < 2) return null;
        const sorted = cand.slice().sort((a, b) => scoreOf(a) - scoreOf(b));
        let best: [string, string] | null = null;
        let bestScore = Infinity;
        for (let i = 0; i < sorted.length - 1; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i], b = sorted[j];
            const diff = Math.abs(scoreOf(a) - scoreOf(b));
            const s = diff * 12 + oppSeen(a, b) * 60 + Math.random() * 0.5;
            if (s < bestScore) {
              bestScore = s;
              best = [a, b];
            }
          }
        }
        return best;
      };
  
      const pickDoubles = (): { teamA: [string, string]; teamB: [string, string] } | null => {
        const cand = PLAYERS.filter((p) => !used.has(p) && available.has(p));
        if (cand.length < 4) return null;
        let best: { teamA: [string, string]; teamB: [string, string] } | null = null;
        let bestScore = Infinity;
  
        // >>> FIX: idem destructure per quad
        for (const [a, b, c, d] of combinations4(cand)) {
          const splits: Array<[[string, string], [string, string]]> = [
            [[a, b], [c, d]],
            [[a, c], [b, d]],
            [[a, d], [b, c]],
          ];
          for (const [t1, t2] of splits) {
            const [x1, x2] = t1, [y1, y2] = t2;
            const sumA = scoreOf(x1) + scoreOf(x2);
            const sumB = scoreOf(y1) + scoreOf(y2);
            const sumDiff = Math.abs(sumA - sumB);
            let s = 0;
            s += sumDiff * 15;
            s += oppSeen(x1, y1) + oppSeen(x1, y2) + oppSeen(x2, y1) + oppSeen(x2, y2);
            s += Math.random() * 0.5;
            if (s < bestScore) {
              bestScore = s;
              best = { teamA: [x1, x2], teamB: [y1, y2] };
            }
          }
        }
        return best;
      };
  
      groups.forEach((size, idxInHour) => {
        const court = idxInHour + 1;
        if (size === 2) {
          const pair = pickSingles();
          if (!pair) return;
          const [a, b] = pair;
          used.add(a); used.add(b);
          result.push({
            date: hr.dateStr,
            timeSlot: hr.slotId,
            court,
            matchType: 'single',
            players: [a, b],
            origin: 'training',
          });
          mt[getCourtKey(hr.dateStr, hr.slotId, court)] = 'single';
        } else {
          const grp = pickDoubles();
          if (!grp) return;
          const { teamA, teamB } = grp;
          const [x1, x2] = teamA, [y1, y2] = teamB;
          [x1, x2, y1, y2].forEach((p) => used.add(p));
          result.push({
            date: hr.dateStr,
            timeSlot: hr.slotId,
            court,
            matchType: 'double',
            players: [x1, x2, y1, y2],
            origin: 'training',
          });
          mt[getCourtKey(hr.dateStr, hr.slotId, court)] = 'double';
        }
      });
    });
  
    setReservations((prev) => {
      const next = [...prev, ...result];
      localStorage.setItem(RESERV_KEY, JSON.stringify(next));
      return next;
    });
    setMatchTypes((prev) => ({ ...prev, ...mt }));
  };
  

  /* --- UI helpers --- */
  const renderDateOption = (d: Date) => {
    const dateStr = format(d, 'yyyy-MM-dd');
    const display = format(d, 'eeee dd/MM/yyyy', { locale: nl });
    return (
      <option key={dateStr} value={dateStr}>
        {display}
      </option>
    );
  };

  const selectedSunday = sundays.find(
    (d) => format(d, 'yyyy-MM-dd') === selectedDate
  );
  const selectedIndex = sundays.findIndex(
    (d) => format(d, 'yyyy-MM-dd') === selectedDate
  );
  const gotoPrev = () => {
    if (selectedIndex > 0)
      setSelectedDate(format(sundays[selectedIndex - 1], 'yyyy-MM-dd'));
  };
  const gotoNext = () => {
    if (selectedIndex < sundays.length - 1)
      setSelectedDate(format(sundays[selectedIndex + 1], 'yyyy-MM-dd'));
  };

  /* --- Components --- */
  const selectClass =
    'w-full p-2 border border-gray-300 rounded text-sm font-medium focus:ring-1 focus:ring-blue-500 bg-white text-gray-900 placeholder-gray-400';
  const inputClass =
    'w-full border border-gray-300 rounded px-3 py-2 bg-white text-gray-900 placeholder-gray-400';

  // ⬇️ vergroting terrein + extra onderruimte
  const courtClass =
    'relative bg-green-600 rounded-xl p-5 h-80 md:h-96 pb-14 flex flex-col justify-between border-4 border-green-700';

  const ReservationBadge = ({ r }: { r: Reservation }) => (
    <div className="absolute top-1 left-1 flex gap-1">
      <div className="bg-white rounded-full px-2 py-1 text-[10px] font-bold">
        {r.matchType === 'single' ? '👤👤' : '👥👥'}
      </div>
      <div
        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
          r.origin === 'challenge'
            ? 'bg-purple-100 text-purple-700'
            : 'bg-yellow-100 text-yellow-800'
        }`}
        title={r.origin === 'challenge' ? 'Uitdaging' : 'Training'}
      >
        {r.origin === 'challenge' ? 'Uitdaging' : 'Training'}
      </div>
      {r.result && (
        <div className="rounded-full px-2 py-1 text-[10px] font-semibold bg-green-100 text-green-700">
          ✅ {r.result.winner}
        </div>
      )}
    </div>
  );

  const TennisCourt = ({
    date,
    timeSlot,
    court,
  }: {
    date: string;
    timeSlot: string;
    court: number;
  }) => {
    const key = getCourtKey(date, timeSlot, court);
    const reservation = reservations.find(
      (r) => r.date === date && r.timeSlot === timeSlot && r.court === court
    );
    const matchType = getMatchType(date, timeSlot, court);
    const selected = selectedPlayers[key] || [];

    if (reservation) {
      const mayEdit = canModifyReservation(reservation);
      const winner = reservation.result?.winner;

      // ⬇️ ruimer geplaatste, wrapbare knoppen onderaan
      const markWinnerButtons =
        reservation.origin === 'challenge' &&
        reservation.matchType === 'single' &&
        !winner &&
        mayEdit ? (
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2 justify-center">
            {reservation.players.map((p) => (
              <button
                key={p}
                onClick={() => {
                  const ch = challenges.find(
                    (c) => c.id === reservation.challengeId
                  );
                  if (!ch) return alert('Uitdaging niet gevonden.');
                  markChallengeWinner(ch, p);
                }}
                className="px-3 py-1.5 rounded-full text-xs bg-white text-black hover:bg-white shadow border border-gray-200"
                title="Markeer winnaar"
              >
                ✅ {p} won
              </button>
            ))}
          </div>
        ) : null;

      return (
        <div className={courtClass}>
          <ReservationBadge r={reservation} />

          {reservation.matchType === 'single' ? (
            <>
              <div className="bg-blue-600 text-white text-center py-3 rounded border-2 border-white text-base font-semibold">
                <div className="flex items-center justify-center">
                  <PlayerChip
                    name={reservation.players[0]}
                    size="md"
                    highlight={winner === reservation.players[0]}
                  />
                </div>
              </div>
              <TennisNet />
              <div className="bg-blue-600 text-white text-center py-3 rounded border-2 border-purple text-base font-semibold">
                <div className="flex items-center justify-center">
                  <PlayerChip
                    name={reservation.players[1]}
                    size="md"
                    highlight={winner === reservation.players[1]}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <div className="bg-blue-600 text-white text-center py-2 rounded border-2 border-white text-sm font-semibold">
                  <div className="flex items-center justify-center">
                    <PlayerChip name={reservation.players[0]} size="sm" />
                  </div>
                </div>
                <div className="bg-blue-600 text-white text-center py-2 rounded border-2 border-white text-sm font-semibold">
                  <div className="flex items-center justify-center">
                    <PlayerChip name={reservation.players[1]} size="sm" />
                  </div>
                </div>
              </div>
              <TennisNet />
              <div className="space-y-1">
                <div className="bg-blue-600 text-white text-center py-2 rounded border-2 border-white text-sm font-semibold">
                  <div className="flex items-center justify-center">
                    <PlayerChip name={reservation.players[2]} size="sm" />
                  </div>
                </div>
                <div className="bg-blue-600 text-white text-center py-2 rounded border-2 border-white text-sm font-semibold">
                  <div className="flex items-center justify-center">
                    <PlayerChip name={reservation.players[3]} size="sm" />
                  </div>
                </div>
              </div>
            </>
          )}

          {mayEdit && (
            <button
              onClick={() => removeReservation(date, timeSlot, court)}
              className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs hover:bg-red-600"
              title="Verwijder reservatie"
            >
              ×
            </button>
          )}

          {markWinnerButtons}
        </div>
      );
    }

    return (
      <div className={courtClass}>
        <div className="flex justify-center gap-2 mb-2">
          <button
            onClick={() => setMatchTypeFor(date, timeSlot, court, 'single')}
            className={`px-3 py-1 rounded text-sm font-bold ${
              matchType === 'single'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700'
            }`}
          >
            👤👤
          </button>
          <button
            onClick={() => setMatchTypeFor(date, timeSlot, court, 'double')}
            className={`px-3 py-1 rounded text-sm font-bold ${
              matchType === 'double'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700'
            }`}
          >
            👥👥
          </button>
        </div>

        {Array.from({ length: matchType === 'single' ? 2 : 4 }).map(
          (_, idx) => (
            <div key={`sel-${idx}`}>
              <select
                value={selected[idx] || ''}
                onChange={(e) =>
                  handlePlayerSelect(date, timeSlot, court, idx, e.target.value)
                }
                className={selectClass}
              >
                <option value="">Speler {idx + 1}</option>
                {playersAvailableFor(date, timeSlot).map((p) => (
                  <option key={p} value={p}>
                    {p} ({scoreOf(p)})
                  </option>
                ))}
              </select>
              {(matchType === 'single' ? idx === 0 : idx === 1) && (
                <TennisNet />
              )}
            </div>
          )
        )}

        <button
          onClick={() => handleReservation(date, timeSlot, court)}
          disabled={
            selected.length !== (matchType === 'single' ? 2 : 4) ||
            selected.some((p) => !p)
          }
          className="w-full bg-blue-600 text-white py-2 px-3 rounded text-sm disabled:opacity-50"
        >
          Reserveren
        </button>
      </div>
    );
  };

  /* --- Mijn beschikbaarheid (alleen eigen speler) --- */
  /* --- Mijn beschikbaarheid (alleen eigen speler) --- */
  const MyAvailability = ({ playerName }: { playerName: string }) => {
    const toggle = (date: string, slot: string) => {
      setAvailability((prev) => {
        const copy: Availability = JSON.parse(JSON.stringify(prev || {}));
        copy[date] = copy[date] || {};
        copy[date][slot] = copy[date][slot] || {};
        const cur = copy[date][slot][playerName];
        copy[date][slot][playerName] = cur === false ? true : false;
        localStorage.setItem('tennis-availability', JSON.stringify(copy));
        return copy;
      });
    };

    return (
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Mijn beschikbaarheid</h3>
          <span className="text-xs text-gray-500">
            Ok = beschikbaar, niet = niet beschikbaar
          </span>
        </div>

        {/* Extra legend voor kleine schermen */}
        <div className="md:hidden mb-2 flex flex-wrap gap-2">
          {TIME_SLOTS.map((s) => (
            <span
              key={s.id}
              className="px-2 py-1 rounded-full text-[11px] bg-gray-100 text-gray-700 border border-gray-200"
            >
              {s.label}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs table-fixed">
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                <th className="text-left py-2 pr-3 w-36 text-black">Datum</th>
                {TIME_SLOTS.map((s) => (
                  <th
                    key={s.id}
                    className="text-left py-2 pr-3 w-36 text-black"
                  >
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sundays.map((d) => {
                const dateStr = format(d, 'yyyy-MM-dd');
                return (
                  <tr key={dateStr} className="border-t">
                    <td className="py-1 pr-3 text-gray-900 whitespace-nowrap">
                      {format(d, 'eee dd/MM', { locale: nl })}
                    </td>
                    {TIME_SLOTS.map((s) => {
                      const disallowed =
                        availability?.[dateStr]?.[s.id]?.[playerName] === false;
                      return (
                        <td
                          key={`${dateStr}-${s.id}`}
                          className="py-1 pr-3 align-top"
                        >
                          {/* Toon het uur ook in de cel op kleine schermen */}
                          <div className="md:hidden text-[10px] text-black-500 mb-0.5">
                            {s.label}
                          </div>
                          <button
                            onClick={() => toggle(dateStr, s.id)}
                            className={`px-2 py-1 rounded border ${
                              disallowed
                                ? 'bg-red-50 border-red-200 text-red-700'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {disallowed ? 'Niet' : 'Ok'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /* --- Uitdagingen-overzicht --- */
  const MyChallenges = () => {
    if (!isLoggedIn) return null;
    const sent = challenges
      .filter((c) => c.from === myName)
      .sort((a, b) => b.createdAt - a.createdAt);
    const received = challenges
      .filter((c) => c.to === myName)
      .sort((a, b) => b.createdAt - a.createdAt);

    const StatusPill = ({ status }: { status: ChallengeStatus }) => {
      const map: Record<ChallengeStatus, string> = {
        pending: 'bg-amber-100 text-amber-800',
        accepted: 'bg-blue-100 text-blue-800',
        declined: 'bg-red-100 text-red-800',
        completed: 'bg-green-100 text-green-800',
      };
      return (
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[status]}`}
        >
          {status}
        </span>
      );
    };

    const ChallengeItem = ({ c }: { c: Challenge }) => {
      const dateLab = `${format(new Date(c.date), 'dd/MM', { locale: nl })} ${
        c.slot
      }`;
      const canMarkWinner =
        c.status === 'accepted' &&
        (c.from === myName || c.to === myName || isAdmin) &&
        !c.result;

      return (
        <li className="p-2 bg-white border rounded text-sm">
          <div className="flex items-center justify-between">
            <div>
              {c.from} vs {c.to} —{' '}
              <span className="text-gray-600">{dateLab}</span>
            </div>
            <StatusPill status={c.status} />
          </div>

          {c.result && (
            <div className="mt-1 text-green-700 text-xs">
              ✅ {c.result.winner} won
            </div>
          )}

          {canMarkWinner && (
            <div className="mt-2 flex gap-2">
              {[c.from, c.to].map((p) => (
                <button
                  key={p}
                  onClick={() => markChallengeWinner(c, p)}
                  className="px-2 py-1 rounded text-xs bg-green-600 text-white hover:bg-green-700"
                >
                  Markeer {p} als winnaar
                </button>
              ))}
            </div>
          )}

          {c.status === 'pending' && c.to === myName && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => acceptChallenge(c)}
                className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs"
              >
                Accepteren
              </button>
              <button
                onClick={() => declineChallenge(c)}
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs"
              >
                Weigeren
              </button>
            </div>
          )}
        </li>
      );
    };

    return (
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-2">
            📤 Mijn uitdagingen (verzonden)
          </h3>
          {sent.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nog geen verzonden uitdagingen.
            </p>
          ) : (
            <ul className="space-y-2">
              {sent.map((c) => (
                <ChallengeItem key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-2">
            📥 Uitdagingen aan mij (ontvangen)
          </h3>
          {received.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nog geen ontvangen uitdagingen.
            </p>
          ) : (
            <ul className="space-y-2">
              {received.map((c) => (
                <ChallengeItem key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  /* --- Notifications panel --- */
  const [notifOpen, setNotifOpen] = useState(false);
  const NotificationsPanel = () => {
    if (!isLoggedIn) return null;
    const mine = notifs
      .filter((n) => n.to === myName)
      .sort((a, b) => b.createdAt - a.createdAt);
    const myChallenges = challenges.filter(
      (c) => c.to === myName && c.status === 'pending'
    );

    return (
      <div className="relative">
        <button
          onClick={() => {
            setNotifOpen((v) => !v);
            if (!notifOpen) markAllRead();
          }}
          className="relative bg-white border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
          title="Meldingen"
        >
          🔔 Meldingen
          {unreadCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 text-xs rounded-full bg-red-600 text-white px-1">
              {unreadCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-white rounded-xl shadow-xl border border-gray-200 z-50">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="font-semibold text-gray-800">Meldingen</div>
              <button
                onClick={() => setNotifOpen(false)}
                className="text-gray-500 hover:text-gray-800"
              >
                ✕
              </button>
            </div>

            {myChallenges.length > 0 && (
              <div className="p-3 border-b">
                <div className="text-sm font-semibold text-gray-800 mb-2">
                  Uitdagingen aan jou
                </div>
                <ul className="space-y-2">
                  {myChallenges.map((c) => (
                    <li key={c.id} className="p-2 bg-gray-50 border rounded">
                      <div className="text-sm text-gray-800">
                        <b>{c.from}</b> daagt je uit op{' '}
                        {format(new Date(c.date), 'dd/MM', { locale: nl })}{' '}
                        {c.slot}.
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => acceptChallenge(c)}
                          className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs"
                        >
                          Accepteren
                        </button>
                        <button
                          onClick={() => declineChallenge(c)}
                          className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs"
                        >
                          Weigeren
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-96 overflow-auto p-3">
              {mine.length === 0 ? (
                <p className="text-sm text-gray-500">Geen meldingen.</p>
              ) : (
                <ul className="space-y-2">
                  {mine.map((n) => (
                    <li
                      key={n.id}
                      className="p-2 bg-white border rounded text-sm text-gray-800"
                    >
                      {n.type === 'challenge' && (
                        <div>
                          Je bent uitgedaagd door <b>{n.payload.from}</b> voor{' '}
                          {format(new Date(n.payload.date), 'dd/MM', {
                            locale: nl,
                          })}{' '}
                          {n.payload.slot}.
                        </div>
                      )}
                      {n.type === 'challenge-sent' && (
                        <div>
                          Uitdaging verstuurd naar <b>{n.payload.to}</b> voor{' '}
                          {format(new Date(n.payload.date), 'dd/MM', {
                            locale: nl,
                          })}{' '}
                          {n.payload.slot}.
                        </div>
                      )}
                      {n.type === 'challenge-accepted' && (
                        <div>
                          Uitdaging geaccepteerd. Ingepland op{' '}
                          {format(new Date(n.payload.date), 'dd/MM', {
                            locale: nl,
                          })}{' '}
                          {n.payload.slot} (Terrein {n.payload.court}).
                        </div>
                      )}
                      {n.type === 'challenge-declined' && (
                        <div>
                          Uitdaging geweigerd door <b>{n.payload.by}</b>.
                        </div>
                      )}
                      {n.type === 'match-reminder' && (
                        <div>
                          Herinnering: je speelt vandaag om{' '}
                          <b>{n.payload.slot}</b> (Terrein {n.payload.court}).
                        </div>
                      )}
                      {n.type === 'match-result' && (
                        <div>
                          Uitslag geregistreerd: <b>{n.payload.winner}</b> won.
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-gray-500">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* --- Ladder component --- */
  const LadderPage = () => {
    const playerStats = useMemo(() => {
      const stats: Record<
        string,
        { wins: number; losses: number; matches: number }
      > = {};
      PLAYERS.forEach((p) => (stats[p] = { wins: 0, losses: 0, matches: 0 }));
      reservations.forEach((r) => {
        if (r.matchType !== 'single' || !r.result) return;
        const { winner, loser } = r.result;
        if (!stats[winner] || !stats[loser]) return;
        stats[winner].wins++;
        stats[winner].matches++;
        stats[loser].losses++;
        stats[loser].matches++;
      });
      return stats;
    }, [reservations]);

    const sortedPlayers = PLAYERS.slice().sort((a, b) => {
      const A = playerStats[a],
        B = playerStats[b];
      if (B.wins !== A.wins) return B.wins - A.wins;
      if (B.matches !== A.matches) return B.matches - A.matches;
      return a.localeCompare(b);
    });

    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">🏆 Ladder</h2>
        <p className="text-sm text-gray-600 mb-6">
          De ladder telt <b>enkel</b> wedstrijden waarvan de <b>uitslag</b> is
          gemarkeerd via een <b>uitdaging</b>. Trainingen of wedstrijden zonder
          uitslag tellen niet mee. Markeer de winnaar bij de uitdaging of op het
          terrein.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4">Positie</th>
                <th className="text-left py-3 px-4">Speler</th>
                <th className="text-left py-3 px-4">Gespeeld</th>
                <th className="text-left py-3 px-4">Gewonnen</th>
                <th className="text-left py-3 px-4">Verloren</th>
                <th className="text-left py-3 px-4">Win %</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((player, index) => {
                const s = playerStats[player];
                const winPct =
                  s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0;
                return (
                  <tr key={player} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 font-bold text-gray-600">
                      #{index + 1}
                    </td>
                    <td className="py-3 px-4">
                      <PlayerChip name={player} size="md" />
                    </td>
                    <td className="py-3 px-4">{s.matches}</td>
                    <td className="py-3 px-4 text-green-600 font-semibold">
                      {s.wins}
                    </td>
                    <td className="py-3 px-4 text-red-600 font-semibold">
                      {s.losses}
                    </td>
                    <td className="py-3 px-4 font-semibold">{winPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /* --- Render --- */
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-green-800">
              🎾 Zondagavondtennis
            </h1>
            <p className="text-gray-600">Reserveer je terrein</p>
          </div>

        <div className="flex items-center gap-2">
            <NotificationsPanel />
            {isAdmin && (
              <button
                onClick={resetAllUsers}
                className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded text-sm"
                title="Vaste logins opnieuw instellen"
              >
                Reset logins
              </button>
            )}
            <button
              onClick={() => {
                if (!isLoggedIn) setAuthOpen(true);
                else logoutUser();
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded"
            >
              {isLoggedIn ? `Uitloggen (${current!.playerName})` : 'Inloggen'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('reservations')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'reservations'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🎾 Reservaties
              </button>
              {isLoggedIn && (
                <button
                  onClick={() => setActiveTab('availability')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'availability'
                      ? 'border-green-500 text-green-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  📅 Mijn beschikbaarheid
                </button>
              )}
              <button
                onClick={() => setActiveTab('ladder')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'ladder'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🏆 Ladder
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'reservations' && (
          <>
            {/* Uitdagen (alleen ingelogd) */}
            {isLoggedIn && (
              <div className="bg-white rounded-xl shadow p-4 mb-6">
                <h3 className="font-semibold text-gray-800 mb-3">
                  🧗 Iemand uitdagen
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Tegenstander
                    </label>
                    <select
                      className={selectClass}
                      value={challengeTo}
                      onChange={(e) => setChallengeTo(e.target.value)}
                    >
                      {PLAYERS.map((p) => (
                        <option key={p} value={p} disabled={p === myName}>
                          {p}
                          {p === myName ? ' (jij)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Datum
                    </label>
                    <select
                      className={selectClass}
                      value={challengeDate}
                      onChange={(e) => setChallengeDate(e.target.value)}
                    >
                      {sundays.map((d) => {
                        const val = format(d, 'yyyy-MM-dd');
                        const lab = format(d, 'eeee dd/MM/yyyy', {
                          locale: nl,
                        });
                        return (
                          <option key={val} value={val}>
                            {lab}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Uur
                    </label>
                    <select
                      className={selectClass}
                      value={challengeSlot}
                      onChange={(e) => setChallengeSlot(e.target.value)}
                    >
                      {TIME_SLOTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() =>
                        createChallenge(
                          challengeTo,
                          challengeDate,
                          challengeSlot
                        )
                      }
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded"
                    >
                      Verstuur uitdaging
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Bij accepteren wordt automatisch een single ingepland op de
                  eerste vrije court.
                </p>
              </div>
            )}

            {/* Mijn uitdagingen */}
            <MyChallenges />

            {/* Planner-acties (alleen admin) */}
            {isAdmin && (
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={planAllBalanced}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
                >
                  🏆 Plan punten + singles (ALLE speeldagen, met
                  beschikbaarheid)
                </button>
                <button
                  onClick={planSelectedWeek}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  🔁 Herplan geselecteerde week
                </button>
                <button
                  onClick={() => {
                    const ok = window.confirm('Alle reservaties wissen?');
                    if (ok) {
                      setReservations([]);
                      setSelectedPlayers({});
                      setMatchTypes({});
                      localStorage.setItem(RESERV_KEY, JSON.stringify([]));
                      localStorage.setItem(MATCHTYPES_KEY, JSON.stringify({}));
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                >
                  🧼 Wis alle reservaties
                </button>
              </div>
            )}

            {/* Date navigation */}
            <div className="mb-6 flex items-center justify-center gap-2">
              <button
                onClick={gotoPrev}
                disabled={selectedIndex <= 0}
                className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded disabled:opacity-50"
              >
                ← Vorige
              </button>
              <select
                className={`${selectClass} min-w-64`}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                {sundays.map(renderDateOption)}
              </select>
              <button
                onClick={gotoNext}
                disabled={selectedIndex >= sundays.length - 1}
                className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded disabled:opacity-50"
              >
                Volgende →
              </button>
            </div>

            {/* Geselecteerde speeldag */}
            {selectedSunday &&
              (() => {
                const dateStr = format(selectedSunday, 'yyyy-MM-dd');
                const displayDate = format(selectedSunday, 'dd/MM/yyyy', {
                  locale: nl,
                });
                const weekIndex = sundays.findIndex(
                  (d) => format(d, 'yyyy-MM-dd') === dateStr
                );

                return (
                  <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-gray-800">
                        Week {weekIndex + 1}
                      </h2>
                      <div className="text-2xl font-bold text-gray-800">
                        {displayDate}
                      </div>
                    </div>

                    {TIME_SLOTS.map((slot) => (
                      <div key={slot.id} className="mb-8">
                        <h3 className="text-xl font-semibold text-gray-700 mb-4">
                          {slot.label}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {[1, 2, 3].map((court) => (
                            <div key={court} className="text-center">
                              <div className="text-sm font-medium text-gray-600 mb-2">
                                Terrein {court}
                              </div>
                              <TennisCourt
                                date={dateStr}
                                timeSlot={slot.id}
                                court={court}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
          </>
        )}

        {activeTab === 'availability' && isLoggedIn && (
          <MyAvailability playerName={current!.playerName} />
        )}

        {activeTab === 'ladder' && <LadderPage />}

        {/* Footer */}
        <div className="mt-6 text-center text-s text-gray-500">
          <p>💡 Tip: Je data worden lokaal opgeslagen in je browser.</p>
          <p>
            🎾 Klik op 👤👤 voor enkelspel of 👥👥 voor dubbelspel per terrein
          </p>
        </div>
        <br />
        <div className="mt-1 text-center text-xs text-gray-500">
          <p>© 2025 Mattias Van der Stuyft. Alle rechten voorbehouden.</p>
        </div>
      </div>

      {/* Auth modal */}
      {authOpen && (
        <div className="fixed inset-0 bg-black/50 grid place-items-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Inloggen</h3>
              <button
                onClick={() => setAuthOpen(false)}
                className="text-gray-600 hover:text-gray-800"
              >
                ✕
              </button>
            </div>

            {authErr && (
              <div className="mb-3 text-sm text-red-600">{authErr}</div>
            )}

            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">
                Spelersnaam
              </label>
              <input
                type="text"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                className={inputClass}
                placeholder="bv. Mattias"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-700 mb-1">
                Wachtwoord
              </label>
              <input
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Gebruik je vaste spelersnaam en wachtwoord. Vraag ze op bij
              Mattias indien onbekend.
            </p>

            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={submitAuth}
                className="px-4 py-2 rounded bg-purple-600 text-white"
              >
                Inloggen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
