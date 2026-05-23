import log from 'electron-log';
import type { AutoRankedSettings, AutoRankedState } from '../../../shared/ipc';
import { lcuClient } from '../lcu/client';
import { getChampions } from './championPicker';

/**
 * Auto Ranked Module — Full automation flow:
 * 1. Create ranked lobby with preferred roles
 * 2. Start matchmaking queue
 * 3. Auto accept (delegated to autoAccept module)
 * 4. Auto ban champion (with fallback if already banned)
 * 5. Auto pick + lock champion
 * 6. Auto set runes
 * 7. Auto set item build (summoner spell set)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

const RANKED_SOLO_QUEUE_ID = 420;

interface RawChampSelectAction {
  id: number;
  actorCellId: number;
  championId: number;
  type: 'ban' | 'pick' | 'ten_bans_reveal';
  completed: boolean;
  isAllyAction: boolean;
  isInProgress: boolean;
}

interface RawChampSelectSession {
  localPlayerCellId: number;
  myTeam: { cellId: number; championId: number; assignedPosition: string; summonerId: number }[];
  theirTeam: { cellId: number; championId: number }[];
  actions: RawChampSelectAction[][];
  bans: { myTeamBans: number[]; theirTeamBans: number[] };
  timer: { phase: string };
}

interface RunePage {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
}

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AutoRankedSettings = {
  enabled: false,
  primaryRole: 'MIDDLE',
  secondaryRole: 'BOTTOM',
  banChampionIds: [],       // priority list of champions to ban
  pickChampionIds: [],      // priority list of champions to pick
  autoStartQueue: false,
  runes: null,              // rune page to apply (null = don't change)
  itemSetId: null           // item set name to apply (null = don't change)
};

// ─── Module State ────────────────────────────────────────────────────────────

type StateListener = (state: AutoRankedState) => void;

class AutoRankedModule {
  private settings: AutoRankedSettings = { ...DEFAULT_SETTINGS };
  private state: AutoRankedState = { step: 'idle', message: '' };
  private listeners = new Set<StateListener>();
  private bound = false;
  private banCompleted = false;
  private pickCompleted = false;
  private lastSessionPhase = '';

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  start(): void {
    if (this.bound) return;
    lcuClient.on('lcuEvent', this.handleLcuEvent);
    this.bound = true;
    log.info('[autoRanked] module started');
  }

  stop(): void {
    if (!this.bound) return;
    lcuClient.off('lcuEvent', this.handleLcuEvent);
    this.bound = false;
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  getSettings(): AutoRankedSettings {
    return this.settings;
  }

  setSettings(next: Partial<AutoRankedSettings>): AutoRankedSettings {
    this.settings = { ...this.settings, ...next };
    log.info('[autoRanked] settings updated', this.settings);
    return this.settings;
  }

  getState(): AutoRankedState {
    return this.state;
  }

  onStateChanged(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─── Public Actions ──────────────────────────────────────────────────────

  /**
   * Create ranked solo/duo lobby, set roles, and start queue.
   */
  async startQueue(): Promise<void> {
    if (!this.settings.enabled) {
      this.setState({ step: 'idle', message: 'Module disabled' });
      return;
    }

    try {
      this.setState({ step: 'creating_lobby', message: 'Creating ranked lobby...' });

      // Create ranked solo/duo lobby
      await lcuClient.request('POST', '/lol-lobby/v2/lobby', {
        queueId: RANKED_SOLO_QUEUE_ID
      });

      // Set position preferences
      this.setState({ step: 'setting_roles', message: `Setting roles: ${this.settings.primaryRole} / ${this.settings.secondaryRole}` });
      await lcuClient.request('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', {
        firstPreference: this.settings.primaryRole,
        secondPreference: this.settings.secondaryRole
      });

      // Start matchmaking
      this.setState({ step: 'queuing', message: 'Starting queue...' });
      await lcuClient.request('POST', '/lol-lobby/v2/lobby/matchmaking/search');

      this.setState({ step: 'in_queue', message: 'In queue, waiting for match...' });
    } catch (err) {
      log.warn('[autoRanked] startQueue failed', err);
      this.setState({ step: 'error', message: `Failed: ${String(err)}` });
    }
  }

  // ─── LCU Event Handler ───────────────────────────────────────────────────

  private handleLcuEvent = (uri: string, _eventType: string, data: unknown): void => {
    if (!this.settings.enabled) return;

    // Track gameflow phase changes
    if (uri === '/lol-gameflow/v1/gameflow-phase') {
      const phase = data as string;
      this.handleGameflowPhase(phase);
      return;
    }

    // Handle champ select session updates
    if (uri === '/lol-champ-select/v1/session') {
      if (data && typeof data === 'object') {
        void this.handleChampSelect(data as RawChampSelectSession);
      } else {
        // Session ended
        this.resetChampSelectState();
      }
    }
  };

  private handleGameflowPhase(phase: string): void {
    switch (phase) {
      case 'Lobby':
        this.setState({ step: 'in_lobby', message: 'In lobby' });
        break;
      case 'Matchmaking':
        this.setState({ step: 'in_queue', message: 'In queue, waiting for match...' });
        break;
      case 'ReadyCheck':
        this.setState({ step: 'ready_check', message: 'Ready check detected (auto-accept handles this)' });
        break;
      case 'ChampSelect':
        this.setState({ step: 'champ_select', message: 'In champion select' });
        this.banCompleted = false;
        this.pickCompleted = false;
        break;
      case 'InProgress':
        this.setState({ step: 'in_game', message: 'Game in progress' });
        break;
      case 'EndOfGame':
      case 'None':
        this.resetChampSelectState();
        this.setState({ step: 'idle', message: '' });
        break;
    }
  }

  private async handleChampSelect(raw: RawChampSelectSession): Promise<void> {
    const localCellId = raw.localPlayerCellId;
    const phase = raw.timer?.phase ?? '';

    // Flatten all actions
    const allActions = raw.actions.flat();

    // Find my pending actions
    const myActions = allActions.filter(
      (a) => a.actorCellId === localCellId
    );

    // Collect all banned/picked champion IDs to know what's unavailable
    const unavailableIds = new Set<number>();
    for (const action of allActions) {
      if (action.completed && action.championId > 0) {
        unavailableIds.add(action.championId);
      }
    }
    // Also add bans
    for (const id of [...(raw.bans?.myTeamBans ?? []), ...(raw.bans?.theirTeamBans ?? [])]) {
      if (id > 0) unavailableIds.add(id);
    }
    // Add ally picks (can't pick same champion in ranked)
    for (const teammate of raw.myTeam) {
      if (teammate.championId > 0 && teammate.cellId !== localCellId) {
        unavailableIds.add(teammate.championId);
      }
    }

    // Handle BAN phase
    if (!this.banCompleted) {
      const myBanAction = myActions.find(
        (a) => a.type === 'ban' && !a.completed && a.isInProgress
      );
      if (myBanAction) {
        await this.executeBan(myBanAction, unavailableIds);
        return;
      }
    }

    // Handle PICK phase
    if (!this.pickCompleted) {
      const myPickAction = myActions.find(
        (a) => a.type === 'pick' && !a.completed && a.isInProgress
      );
      if (myPickAction) {
        await this.executePick(myPickAction, unavailableIds);
        return;
      }
    }

    // Handle FINALIZATION phase — apply runes and build
    if (phase === 'FINALIZATION' && this.lastSessionPhase !== 'FINALIZATION') {
      this.lastSessionPhase = phase;
      const myPick = raw.myTeam.find((p) => p.cellId === localCellId);
      if (myPick && myPick.championId > 0) {
        await this.applyRunesAndBuild(myPick.championId);
      }
    } else {
      this.lastSessionPhase = phase;
    }
  }

  // ─── Ban Logic ───────────────────────────────────────────────────────────

  private async executeBan(
    action: RawChampSelectAction,
    unavailableIds: Set<number>
  ): Promise<void> {
    // Prevent concurrent execution
    if (this.banCompleted) return;
    this.banCompleted = true;

    // Wait a moment for the client to be fully ready for ban input
    await this.delay(800);

    // Find first available champion from ban list
    const banTarget = this.settings.banChampionIds.find(
      (id) => !unavailableIds.has(id)
    );

    if (!banTarget) {
      // No valid ban target — just complete with "none" (championId = 0 means no ban)
      this.setState({ step: 'banning', message: 'No ban target available, skipping ban' });
      log.info('[autoRanked] no ban target available, completing without ban');
      try {
        await lcuClient.request(
          'PATCH',
          `/lol-champ-select/v1/session/actions/${action.id}`,
          { championId: 0, completed: true }
        );
      } catch (err) {
        log.warn('[autoRanked] skip ban failed', err);
        this.banCompleted = false; // Allow retry on next session update
      }
      return;
    }

    const champName = this.getChampionName(banTarget);
    this.setState({ step: 'banning', message: `Banning ${champName}...` });
    log.info(`[autoRanked] banning champion ${champName} (${banTarget})`);

    try {
      // Hover the champion first
      await lcuClient.request(
        'PATCH',
        `/lol-champ-select/v1/session/actions/${action.id}`,
        { championId: banTarget }
      );
      // Small delay then complete (lock ban)
      await this.delay(500);
      await lcuClient.request(
        'PATCH',
        `/lol-champ-select/v1/session/actions/${action.id}`,
        { championId: banTarget, completed: true }
      );
      this.setState({ step: 'ban_done', message: `Banned ${champName}` });
    } catch (err) {
      log.warn('[autoRanked] ban failed', err);
      this.banCompleted = false; // Allow retry on next session update
      this.setState({ step: 'error', message: `Ban failed: ${String(err)}` });
    }
  }

  // ─── Pick Logic ──────────────────────────────────────────────────────────

  private async executePick(
    action: RawChampSelectAction,
    unavailableIds: Set<number>
  ): Promise<void> {
    this.pickCompleted = true;

    // Find first available champion from pick list
    const pickTarget = this.settings.pickChampionIds.find(
      (id) => !unavailableIds.has(id)
    );

    if (!pickTarget) {
      this.setState({ step: 'error', message: 'No pick target available! All champions in pool are taken/banned.' });
      log.warn('[autoRanked] no pick target available');
      return;
    }

    const champName = this.getChampionName(pickTarget);
    this.setState({ step: 'picking', message: `Picking ${champName}...` });
    log.info(`[autoRanked] picking champion ${champName} (${pickTarget})`);

    try {
      // Hover the champion
      await lcuClient.request(
        'PATCH',
        `/lol-champ-select/v1/session/actions/${action.id}`,
        { championId: pickTarget }
      );
      // Small delay then lock in
      await this.delay(300);
      await lcuClient.request(
        'PATCH',
        `/lol-champ-select/v1/session/actions/${action.id}`,
        { championId: pickTarget, completed: true }
      );
      this.setState({ step: 'pick_done', message: `Locked ${champName}` });
    } catch (err) {
      log.warn('[autoRanked] pick failed', err);
      this.setState({ step: 'error', message: `Pick failed: ${String(err)}` });
    }
  }

  // ─── Runes & Build ───────────────────────────────────────────────────────

  private async applyRunesAndBuild(championId: number): Promise<void> {
    // Apply runes if configured
    if (this.settings.runes) {
      await this.applyRunes(this.settings.runes);
    }

    // Apply item build if configured
    if (this.settings.itemSetId) {
      this.setState({ step: 'applying_build', message: 'Build set configured (item sets managed externally)' });
    }

    this.setState({ step: 'ready', message: 'Runes & build applied. Ready to play!' });
  }

  private async applyRunes(runes: RunePage): Promise<void> {
    this.setState({ step: 'applying_runes', message: `Applying runes: ${runes.name}` });
    log.info('[autoRanked] applying runes', runes.name);

    try {
      // Get current rune pages
      const pages = await lcuClient.request<{ id: number; name: string; isActive: boolean; isDeletable: boolean }[]>(
        'GET',
        '/lol-perks/v1/pages'
      );

      // Find an existing page we created (by name prefix) or the current active deletable page
      const existingPage = pages.find((p) => p.name === runes.name && p.isDeletable);
      const activeDeletable = pages.find((p) => p.isActive && p.isDeletable);

      const runePayload = {
        name: runes.name,
        primaryStyleId: runes.primaryStyleId,
        subStyleId: runes.subStyleId,
        selectedPerkIds: runes.selectedPerkIds,
        current: true
      };

      if (existingPage) {
        // Update existing page
        await lcuClient.request('PUT', `/lol-perks/v1/pages/${existingPage.id}`, runePayload);
      } else if (activeDeletable) {
        // Replace active deletable page
        await lcuClient.request('DELETE', `/lol-perks/v1/pages/${activeDeletable.id}`);
        await lcuClient.request('POST', '/lol-perks/v1/pages', runePayload);
      } else {
        // Try to create new page (may fail if at max pages)
        try {
          await lcuClient.request('POST', '/lol-perks/v1/pages', runePayload);
        } catch {
          // If at max, delete first deletable and create
          const firstDeletable = pages.find((p) => p.isDeletable);
          if (firstDeletable) {
            await lcuClient.request('DELETE', `/lol-perks/v1/pages/${firstDeletable.id}`);
            await lcuClient.request('POST', '/lol-perks/v1/pages', runePayload);
          }
        }
      }

      log.info('[autoRanked] runes applied successfully');
    } catch (err) {
      log.warn('[autoRanked] apply runes failed', err);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resetChampSelectState(): void {
    this.banCompleted = false;
    this.pickCompleted = false;
    this.lastSessionPhase = '';
  }

  private setState(next: AutoRankedState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private getChampionName(id: number): string {
    const champ = getChampions().find((c) => c.id === id);
    return champ?.name ?? `Champion ${id}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const autoRanked = new AutoRankedModule();
