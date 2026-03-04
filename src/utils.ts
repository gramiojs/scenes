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

		const sceneParams: ScenesStorageData = {
			name: scene.name,
			state: {},
			params: args[0],
			stepId: 0,
			previousStepId: 0,
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

		await scene["~"].enter(context);

		// @ts-expect-error
		await scene.compose(context, async () => {
			const sceneData = await storage.get(key);
			if (!sceneData) return;

			await storage.set(key, { ...sceneData, firstTime: false });
		});
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

		const subData: ScenesStorageData = {
			name: subScene.name,
			state: {},
			params: args[0],
			stepId: 0,
			previousStepId: 0,
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

		await subScene["~"].enter(context);

		// @ts-expect-error
		await subScene.compose(context, async () => {
			const d = await storage.get(key);
			if (!d) return;
			await storage.set(key, { ...d, firstTime: false });
		});
	};
}

export function getSceneExitSub(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: ScenesStorage,
	sceneData: ScenesStorageData,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
) {
	return async (returnData?: Record<string, unknown>) => {
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
		// @ts-expect-error
		await parentScene.run(context, storage, key, parentData);
	};
}

export function getSceneExit(
	storage: Storage,
	sceneData: ScenesStorageData,
	key: `@gramio/scenes:${string | number}`,
) {
	return () => {
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
>(
	context: ContextWithFrom & { scene: InActiveSceneHandlerReturn<any, any> },
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: `@gramio/scenes:${string | number}`,
	allowedScenes: string[],
	allScenes: AnyScene[],
): InActiveSceneHandlerReturn<Params, State> {
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
		update: async (
			state,
			options = {
				step: sceneData.stepId + 1,
			},
		) => {
			sceneData.state = Object.assign(sceneData.state, state);

			// sceneData.stepId.
			// console.log("UPDATE", sceneData.state);

			if (options?.step !== undefined)
				await stepDerives.go(options.step, options.firstTime);
			else await storage.set(key, sceneData);

			return state;
		},
		enter: getSceneEnter(
			context,
			storage as ScenesStorage,
			key,
			allowedScenes,
			allScenes,
		),
		exit: getSceneExit(storage, sceneData, key),
		reenter: async () =>
			getSceneEnter(
				context,
				storage as ScenesStorage,
				key,
				allowedScenes,
				allScenes,
			)(scene, sceneData.params),
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
	async function go(stepId: number, firstTime = true) {
		storageData.previousStepId = storageData.stepId;
		storageData.stepId = stepId;
		storageData.firstTime = firstTime;
		// console.log("Oh we go to step", stepId);
		// await storage.set(key, storageData);

		context.scene = getInActiveSceneHandler(
			context,
			storage,
			storageData,
			scene,
			key,
			allowedScenes,
			allScenes,
		);
		// @ts-expect-error
		await scene.run(context, storage, key, storageData);
	}

	return {
		id: storageData.stepId,
		previousId: storageData.previousStepId,
		firstTime: storageData.firstTime,
		go: go,
		next: () => go(storageData.stepId + 1),
		previous: () => go(storageData.stepId - 1),
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
		exit: getSceneExit(storage, sceneData, key),
		// @ts-expect-error PRIVATE KEY
		"~": {
			data: sceneData,
		},
	};
}

export function validateScenes(scenes: AnyScene[]): void {
	const names = new Set<string>();
	for (const scene of scenes) {
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
