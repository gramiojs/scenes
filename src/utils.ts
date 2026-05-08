import type { Storage } from "@gramio/storage";
import type { Bot, ContextType } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	InActiveSceneHandlerReturn,
	InUnknownScene,
	ParentSceneFrame,
	PossibleInUnknownScene,
	SceneEnterHandler,
	SceneStepReturn,
	SceneUpdateState,
	ScenesStorage,
	ScenesStorageData,
	StateTypesDefault,
} from "./types.js";

type ContextWithFrom = Pick<
	ContextType<Bot, "message" | "callback_query">,
	"from"
>;

export function getSceneEnter(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: ScenesStorage,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): SceneEnterHandler {
	return async (scene, ...args) => {
		if (!allowedScenes.includes(scene.name))
			throw new Error(
				`You should register this scene (${scene.name}) in plugin options (scenes: ${allowedScenes.join(
					", ",
				)})`,
			);

		const initialStepId = scene["~scene"]?.steps?.[0]?.id ?? 0;
		const sceneParams: ScenesStorageData = {
			name: scene.name,
			state: {},
			params: args[0],
			stepId: initialStepId,
			previousStepId: initialStepId,
			firstTime: true,
		};
		await storage.set(key, sceneParams);
		context.scene = getInActiveSceneHandler(
			context,
			storage,
			sceneParams,
			scene,
			key,
			allowedScenes,
			allScenes,
		);

		await scene["~scene"].enter?.(context);

		// Run the active step (builder mode) or the legacy gated chain.
		await scene.dispatchActive(context as any, storage, key, sceneParams);
	};
}

export function getSceneEnterSub(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: ScenesStorage,
	currentSceneData: ScenesStorageData,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): SceneEnterHandler {
	return async (subScene, ...args) => {
		if (!allowedScenes.includes(subScene.name))
			throw new Error(
				`You should register this scene (${subScene.name}) in plugin options (scenes: ${allowedScenes.join(", ")})`,
			);

		const parentFrame: ParentSceneFrame = {
			name: currentSceneData.name,
			params: currentSceneData.params,
			state: currentSceneData.state,
			stepId: currentSceneData.stepId,
			previousStepId: currentSceneData.previousStepId,
			parentStack: currentSceneData.parentStack,
		};

		// Prevent scene.run()'s onNext from overwriting sub-scene storage
		// (same pattern as getSceneExit)
		currentSceneData.firstTime = false;

		const initialStepId = subScene["~scene"]?.steps?.[0]?.id ?? 0;
		const subData: ScenesStorageData = {
			name: subScene.name,
			state: {},
			params: args[0],
			stepId: initialStepId,
			previousStepId: initialStepId,
			firstTime: true,
			parentStack: [...(currentSceneData.parentStack ?? []), parentFrame],
		};

		await storage.set(key, subData);
		context.scene = getInActiveSceneHandler(
			context,
			storage,
			subData,
			subScene,
			key,
			allowedScenes,
			allScenes,
		);

		await subScene["~scene"].enter?.(context);

		await subScene.dispatchActive(context as any, storage, key, subData);
	};
}

export function getSceneExitSub(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	currentScene: AnyScene,
	storage: ScenesStorage,
	sceneData: ScenesStorageData,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
) {
	return async (returnData?: Record<string, unknown>) => {
		// Fire onExit on the sub-scene that's leaving, before merging back up
		await currentScene["~scene"]?.exit?.(context);

		// Prevent scene.run()'s onNext from overwriting parent data
		// (same pattern as getSceneExit)
		sceneData.firstTime = false;

		const stack = sceneData.parentStack;
		if (!stack?.length) {
			await storage.delete(key);
			return;
		}

		const parentFrame = stack[stack.length - 1];
		const remainingStack = stack.slice(0, -1);

		const mergedState = returnData
			? { ...(parentFrame.state as object), ...returnData }
			: parentFrame.state;

		const parentData: ScenesStorageData = {
			name: parentFrame.name,
			params: parentFrame.params,
			state: mergedState,
			stepId: parentFrame.stepId,
			previousStepId: parentFrame.previousStepId,
			firstTime: false,
			parentStack: remainingStack.length > 0 ? remainingStack : undefined,
		};

		await storage.set(key, parentData);

		const parentScene = allScenes.find((s) => s.name === parentFrame.name);
		if (!parentScene) return;

		context.scene = getInActiveSceneHandler(
			context,
			storage,
			parentData,
			parentScene,
			key,
			allowedScenes,
			allScenes,
		);
		await parentScene.dispatchActive(
			context as any,
			storage,
			key,
			parentData,
		);
	};
}

export function getSceneExit(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	scene: AnyScene,
	storage: Storage,
	sceneData: ScenesStorageData,
	key: `@gramio/scenes:${string | number}`,
) {
	return async () => {
		// Fire scene.onExit hook before tearing down storage
		await scene["~scene"]?.exit?.(context);
		// TODO: do it smarter. for now it fix overrides of scene exit
		sceneData.firstTime = false;

		return storage.delete(key);
	};
}

// function isTrue(value: unknown): value is true {
// 	return value === true;
// }

export async function getSceneHandlers<WithCurrentScene extends boolean>(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: ScenesStorage,
	withCurrentScene: WithCurrentScene,
	scenes: AnyScene[],
	allowedScenes: string[],
): Promise<
	WithCurrentScene extends true ? PossibleInUnknownScene<any, any> : EnterExit
> {
	const key = `@gramio/scenes:${context.from?.id ?? 0}` as const;

	const enterExit = {
		enter: getSceneEnter(context, storage, key, allowedScenes, scenes),
		exit: () => storage.delete(key),
	};

	if (withCurrentScene) {
		const sceneData = await storage.get(key);

		// TODO: fix type issues. predicates are not smart for now
		// @ts-expect-error
		if (!sceneData) return enterExit;

		const scene = scenes.find((x) => x.name === sceneData.name);
		// @ts-expect-error
		if (!scene) return enterExit;

		return getPossibleInSceneHandlers(
			context,
			storage,
			sceneData as ScenesStorageData<any, any>,
			scene,
			key,
			allowedScenes,
			scenes,
		);
	}

	// @ts-expect-error
	return enterExit;
}

export function getInActiveSceneHandler<
	Params,
	State extends StateTypesDefault,
	ExitData extends Record<string, unknown> = Record<string, unknown>,
>(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): InActiveSceneHandlerReturn<Params, State, ExitData> {
	const stepDerives = getStepDerives(
		context,
		storage,
		sceneData,
		scene,
		key,
		allowedScenes,
		allScenes,
	);

	return {
		state: sceneData.state,
		params: sceneData.params,
		step: stepDerives,
		update: async (state, options) => {
			sceneData.state = Object.assign(sceneData.state, state);

			// Explicit options.step → jump to that step.
			if (options?.step !== undefined) {
				await stepDerives.go(options.step, options.firstTime);
				return state;
			}
			// Explicit options without step → persist state, no transition.
			if (options !== undefined) {
				await storage.set(key, sceneData);
				return state;
			}

			// No options: advance to the next step.
			//   1. Builder mode (sceneSteps populated): walk array by index.
			//   2. Legacy numeric mode: stepId + 1.
			//   3. Otherwise: just persist (last step / unknown id).
			const sceneSteps = scene["~scene"]?.steps ?? [];
			if (sceneSteps.length > 0) {
				const idx = sceneSteps.findIndex((s) => s.id === sceneData.stepId);
				if (idx >= 0 && idx + 1 < sceneSteps.length) {
					await stepDerives.go(sceneSteps[idx + 1]!.id);
					return state;
				}
			}

			if (typeof sceneData.stepId === "number") {
				await stepDerives.go(sceneData.stepId + 1);
				return state;
			}

			await storage.set(key, sceneData);
			return state;
		},
		enter: getSceneEnter(
			context,
			storage as ScenesStorage,
			key,
			allowedScenes,
			allScenes,
		),
		exit: getSceneExit(context, scene, storage, sceneData, key),
		reenter: async (params) => {
			// Fire onExit before re-entering — semantically the prior occupancy ends.
			await scene["~scene"]?.exit?.(context);
			return getSceneEnter(
				context,
				storage as ScenesStorage,
				key,
				allowedScenes,
				allScenes,
			)(scene, params ?? sceneData.params);
		},
		enterSub: getSceneEnterSub(
			context,
			storage as ScenesStorage,
			sceneData,
			key,
			allowedScenes,
			allScenes,
		),
		exitSub: getSceneExitSub(
			context,
			scene,
			storage as ScenesStorage,
			sceneData,
			key,
			allowedScenes,
			allScenes,
		),
	};
}

export function getStepDerives(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: Storage,
	storageData: ScenesStorageData<any, any>,
	scene: AnyScene,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): SceneStepReturn {
	async function go(stepId: string | number, firstTime = true) {
		storageData.previousStepId = storageData.stepId;
		storageData.stepId = stepId;
		storageData.firstTime = firstTime;

		context.scene = getInActiveSceneHandler(
			context,
			storage,
			storageData,
			scene,
			key,
			allowedScenes,
			allScenes,
		);
		await scene.dispatchActive(
			context as any,
			storage,
			key,
			storageData,
		);
	}

	function relativeStep(delta: 1 | -1, op: "next" | "previous"): Promise<void> {
		// Builder mode: walk `~scene.steps` by index — supports named ids.
		const sceneSteps = scene["~scene"]?.steps ?? [];
		if (sceneSteps.length > 0) {
			const idx = sceneSteps.findIndex((s) => s.id === storageData.stepId);
			if (idx === -1) {
				// Current step lives outside the builder array (legacy gated middleware).
				// Fall through to numeric arithmetic below.
				if (typeof storageData.stepId === "number") {
					return go(storageData.stepId + delta);
				}
				throw new Error(
					`scene.step.${op}(): cannot find current step "${storageData.stepId}" in scene "${scene.name}"`,
				);
			}
			const targetIdx = idx + delta;
			if (targetIdx < 0 || targetIdx >= sceneSteps.length) {
				throw new Error(
					`scene.step.${op}(): no ${op} step from "${storageData.stepId}" in scene "${scene.name}"`,
				);
			}
			return go(sceneSteps[targetIdx]!.id);
		}

		// Legacy mode: numeric arithmetic.
		if (typeof storageData.stepId !== "number") {
			throw new Error(
				`scene.step.${op}() does not yet support named step ids without a step builder. ` +
					`Use scene.step.go("name") to jump to a named step.`,
			);
		}
		return go(storageData.stepId + delta);
	}

	return {
		id: storageData.stepId,
		previousId: storageData.previousStepId,
		firstTime: storageData.firstTime,
		go: go,
		next: () => relativeStep(1, "next"),
		previous: () => relativeStep(-1, "previous"),
	};
}

export function getInUnknownScene<Params, State extends StateTypesDefault>(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): InUnknownScene<Params, State> {
	return {
		...getInActiveSceneHandler(
			context,
			storage,
			sceneData,
			scene,
			key,
			allowedScenes,
			allScenes,
		),
		// @ts-expect-error
		is: (scene) => scene.name === sceneData.name,
	};
}

export function getPossibleInSceneHandlers<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: ScenesStorage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): PossibleInUnknownScene<Params, State> {
	return {
		current: getInUnknownScene(
			context,
			storage,
			sceneData,
			scene,
			key,
			allowedScenes,
			allScenes,
		),
		enter: getSceneEnter(context, storage, key, allowedScenes, allScenes),
		exit: getSceneExit(context, scene, storage, sceneData, key),
		// @ts-expect-error PRIVATE KEY
		"~": {
			data: sceneData,
		},
	};
}

export function validateScenes(scenes: AnyScene[]): void {
	const names = new Set<string>();
	for (const scene of scenes) {
		if (scene["~scene"]?.isModule || !scene.name) {
			throw new Error(
				"Cannot register an unnamed Scene (step module) directly. " +
					"Pass it to scene.extend(module) to merge into a named scene instead.",
			);
		}
		if (names.has(scene.name)) {
			throw new Error(`Duplicate scene name detected: ${scene.name}`);
		}
		names.add(scene.name);
	}
}

export const events = [
	"message",
	"callback_query",
	"channel_post",
	"chat_join_request",
	"chosen_inline_result",
	"inline_query",
	"web_app_data",
	"successful_payment",
	"video_chat_started",
	"video_chat_ended",
	"video_chat_scheduled",
	"video_chat_participants_invited",
	"passport_data",
	"new_chat_title",
	"new_chat_photo",
	"pinned_message",
	// "poll_answer",
	"pre_checkout_query",
	"proximity_alert_triggered",
	"shipping_query",
	"group_chat_created",
	"delete_chat_photo",
	"location",
	"invoice",
	"message_auto_delete_timer_changed",
	"migrate_from_chat_id",
	"migrate_to_chat_id",
	"new_chat_members",
	"chat_shared",
	"users_shared",
] as const;
