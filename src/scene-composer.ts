import {
	createComposer,
	eventTypes,
} from "@gramio/composer";
import {
	_composerMethods,
	type Bot,
	type Context,
	type ContextsMapping,
} from "gramio";

type AnyBot = Bot<any, any, any>;
type TelegramEventMap = {
	[K in keyof ContextsMapping<AnyBot>]: InstanceType<ContextsMapping<AnyBot>[K]>;
};

/**
 * Base class for `Scene`. Produced by `createComposer` with the gramio method
 * table (`.command/.callbackQuery/.hears/.on/.use/.derive/.guard/.branch/.when/
 * .extend/...`) so a `Scene` instance has the full bot-level DSL out of the
 * box. Scene-specific methods (`.params/.state/.exitData/.onEnter/.onExit/
 * .step/.ask`) are added by the `Scene` subclass.
 *
 * Generic slots are left at default (`{}` / no derive accumulation) — Scene
 * tracks its own type chain via the `Derives` generic on the subclass, and
 * `.extend()` merges plugin/composer types into that chain.
 */
export const { Composer: SceneComposerBase } = createComposer<
	Context<AnyBot>,
	TelegramEventMap,
	typeof _composerMethods
>({
	discriminator: (ctx: Context<AnyBot>) => (ctx as any).updateType,
	types: eventTypes<TelegramEventMap>(),
	methods: _composerMethods,
});

export type SceneComposerBaseInstance = InstanceType<typeof SceneComposerBase>;
