import type { z } from '@hono/zod-openapi';
import { Option, Result } from '@mikuroxina/mini-fn';

import type { AccountID, AccountName } from '../../model/account.js';
import type { AccountFollow } from '../../model/follow.js';
import type { AuthenticateService } from '../../service/authenticate.js';
import type { EditService } from '../../service/edit.js';
import type { FetchService } from '../../service/fetch.js';
import type { FetchFollowService } from '../../service/fetchFollow.js';
import type { FollowService } from '../../service/follow.js';
import type { FreezeService } from '../../service/freeze.js';
import type { RegisterService } from '../../service/register.js';
import type { ResendVerifyTokenService } from '../../service/resendToken.js';
import type { SilenceService } from '../../service/silence.js';
import type { UnfollowService } from '../../service/unfollow.js';
import type { VerifyAccountTokenService } from '../../service/verifyToken.js';
import type {
  CreateAccountResponseSchema,
  GetAccountFollowerSchema,
  GetAccountFollowingSchema,
  GetAccountResponseSchema,
  LoginResponseSchema,
  UpdateAccountResponseSchema,
} from '../validator/schema.js';

export class AccountController {
  private readonly registerService: RegisterService;
  private readonly editService: EditService;
  private readonly fetchService: FetchService;
  private readonly freezeService: FreezeService;
  private readonly verifyAccountTokenService: VerifyAccountTokenService;
  private readonly authenticateService: AuthenticateService;
  private readonly silenceService: SilenceService;
  private readonly followService: FollowService;
  private readonly unFollowService: UnfollowService;
  private readonly fetchFollowService: FetchFollowService;
  private readonly resendTokenService: ResendVerifyTokenService;

  constructor(args: {
    registerService: RegisterService;
    editService: EditService;
    fetchService: FetchService;
    freezeService: FreezeService;
    verifyAccountTokenService: VerifyAccountTokenService;
    authenticateService: AuthenticateService;
    silenceService: SilenceService;
    followService: FollowService;
    unFollowService: UnfollowService;
    fetchFollowService: FetchFollowService;
    resendTokenService: ResendVerifyTokenService;
  }) {
    this.registerService = args.registerService;
    this.editService = args.editService;
    this.fetchService = args.fetchService;
    this.freezeService = args.freezeService;
    this.verifyAccountTokenService = args.verifyAccountTokenService;
    this.authenticateService = args.authenticateService;
    this.silenceService = args.silenceService;
    this.followService = args.followService;
    this.unFollowService = args.unFollowService;
    this.fetchFollowService = args.fetchFollowService;
    this.resendTokenService = args.resendTokenService;
  }

  async createAccount(
    name: string,
    email: string,
    passphrase: string,
  ): Promise<
    Result.Result<Error, z.infer<typeof CreateAccountResponseSchema>>
  > {
    const res = await this.registerService.handle(
      name as AccountName,
      email,
      '',
      passphrase,
      '',
      'normal',
    );

    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok({
      id: res[1].getID(),
      name: res[1].getName(),
      email: res[1].getMail(),
    });
  }

  async updateAccount(
    target: string,
    args: {
      nickname?: string;
      email?: string;
      passphrase?: string;
      bio: string;
    },
    etag: string,
    actorName: string,
  ): Promise<
    Result.Result<Error, z.infer<typeof UpdateAccountResponseSchema>>
  > {
    if (args.nickname) {
      const res = await this.editService.editNickname(
        etag,
        target as AccountName,
        args.nickname,
        actorName as AccountName,
      );
      if (Result.isErr(res)) {
        return res;
      }
    }
    if (args.passphrase) {
      const res = await this.editService.editPassphrase(
        etag,
        target as AccountName,
        args.passphrase,
        actorName as AccountName,
      );
      if (Result.isErr(res)) {
        return res;
      }
    }
    if (args.email) {
      const res = await this.editService.editEmail(
        etag,
        target as AccountName,
        args.email,
        actorName as AccountName,
      );
      if (Result.isErr(res)) {
        return res;
      }
    }

    const editedBioResp = await this.editService.editBio(
      etag,
      target as AccountName,
      args.bio,
      actorName as AccountName,
    );
    if (Result.isErr(editedBioResp)) {
      return Result.err(editedBioResp[1]);
    }

    const res = await this.fetchService.fetchAccount(target as AccountName);
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok({
      id: res[1].getID(),
      email: res[1].getMail(),
      name: res[1].getName() as string,
      nickname: res[1].getNickname(),
      bio: res[1].getBio(),
    });
  }

  async freezeAccount(
    target: string,
    actor: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.freezeService.setFreeze(
      target as AccountName,
      actor as AccountName,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async unFreezeAccount(
    name: string,
    actor: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.freezeService.undoFreeze(
      name as AccountName,
      actor as AccountName,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async verifyEmail(
    name: string,
    token: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.verifyAccountTokenService.verify(
      name as AccountName,
      token,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async getAccount(
    id: string,
  ): Promise<Result.Result<Error, z.infer<typeof GetAccountResponseSchema>>> {
    const res = await this.fetchService.fetchAccountByID(id as AccountID);
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok({
      id: res[1].getID(),
      email: res[1].getMail(),
      name: res[1].getName() as string,
      nickname: res[1].getNickname(),
      bio: res[1].getBio(),
      // ToDo: fill the following fields
      avatar: '',
      header: '',
      followed_count: 0,
      following_count: 0,
      note_count: 0,
      created_at: res[1].getCreatedAt(),
      role: res[1].getRole(),
      frozen: res[1].getFrozen(),
      status: res[1].getStatus(),
      silenced: res[1].getSilenced(),
    });
  }

  async getAccountByName(
    name: string,
  ): Promise<Result.Result<Error, z.infer<typeof GetAccountResponseSchema>>> {
    const res = await this.fetchService.fetchAccount(name as AccountName);
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok({
      id: res[1].getID(),
      email: res[1].getMail(),
      name: res[1].getName() as string,
      nickname: res[1].getNickname(),
      bio: res[1].getBio(),
      // ToDo: fill the following fields
      avatar: '',
      header: '',
      followed_count: 0,
      following_count: 0,
      note_count: 0,
      created_at: res[1].getCreatedAt(),
      role: res[1].getRole(),
      frozen: res[1].getFrozen(),
      status: res[1].getStatus(),
      silenced: res[1].getSilenced(),
    });
  }

  async login(
    name: string,
    passphrase: string,
  ): Promise<Result.Result<Error, z.infer<typeof LoginResponseSchema>>> {
    const res = await this.authenticateService.handle(
      name as AccountName,
      passphrase,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok({
      authorization_token: res[1].authorizationToken,
      refresh_token: res[1].refreshToken,
    });
  }

  async silenceAccount(
    targetName: string,
    actorName: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.silenceService.setSilence(
      targetName as AccountName,
      actorName as AccountName,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async unSilenceAccount(
    targetName: string,
    actorName: string,
  ): Promise<Result.Result<Error, void>> {
    // ToDo: check user's permission
    const res = await this.silenceService.undoSilence(
      targetName as AccountName,
      actorName as AccountName,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async followAccount(
    fromName: string,
    targetName: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.followService.handle(
      fromName as AccountName,
      targetName as AccountName,
    );
    if (Result.isErr(res)) {
      return res;
    }

    return Result.ok(undefined);
  }

  async unFollowAccount(
    fromName: string,
    targetName: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.unFollowService.handle(
      fromName as AccountName,
      targetName as AccountName,
    );

    if (Option.isSome(res)) {
      return Result.err(res[1]);
    }

    return Result.ok(undefined);
  }

  async resendVerificationEmail(
    name: string,
  ): Promise<Result.Result<Error, void>> {
    const res = await this.resendTokenService.handle(name as AccountName);
    if (Option.isSome(res)) {
      return Result.err(res[1]);
    }

    return Result.ok(undefined);
  }

  async fetchFollowing(
    id: string,
  ): Promise<Result.Result<Error, z.infer<typeof GetAccountFollowingSchema>>> {
    const followings = Result.map((v: AccountFollow[]) =>
      v.map((v) => v.getTargetID()),
    )(await this.fetchFollowService.fetchFollowingsByID(id as AccountID));

    if (Result.isErr(followings)) {
      return followings;
    }

    const accounts = await this.fetchService.fetchManyAccountsByID(
      Result.unwrap(followings),
    );

    if (Result.isErr(accounts)) {
      return accounts;
    }

    return Result.ok(
      Result.unwrap(accounts).map((v) => {
        return {
          id: v.getID(),
          email: v.getMail(),
          name: v.getName(),
          nickname: v.getNickname(),
          bio: v.getBio(),
          // ToDo: fill the following fields
          avatar: '',
          header: '',
          followed_count: 0,
          following_count: 0,
          note_count: 0,
          created_at: v.getCreatedAt(),
          role: v.getRole(),
          frozen: v.getFrozen(),
          status: v.getStatus(),
          silenced: v.getSilenced(),
        };
      }),
    );
  }

  async fetchFollower(
    id: string,
  ): Promise<Result.Result<Error, z.infer<typeof GetAccountFollowerSchema>>> {
    const followers = Result.map((v: AccountFollow[]) =>
      v.map((v) => v.getFromID()),
    )(await this.fetchFollowService.fetchFollowersByID(id as AccountID));

    if (Result.isErr(followers)) {
      return followers;
    }

    const accounts = await this.fetchService.fetchManyAccountsByID(
      Result.unwrap(followers),
    );

    if (Result.isErr(accounts)) {
      return accounts;
    }

    return Result.ok(
      Result.unwrap(accounts).map((v) => {
        // ToDo: make optional some fields
        return {
          id: v.getID(),
          email: v.getMail(),
          name: v.getName(),
          nickname: v.getNickname(),
          bio: v.getBio(),
          // ToDo: fill the following fields
          avatar: '',
          header: '',
          followed_count: 0,
          following_count: 0,
          note_count: 0,
          created_at: v.getCreatedAt(),
          role: v.getRole(),
          frozen: v.getFrozen(),
          status: v.getStatus(),
          silenced: v.getSilenced(),
        };
      }),
    );
  }
}
