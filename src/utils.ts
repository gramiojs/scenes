import type { Storage } from "@gramio/storage";
import type { Bot, ContextType } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	InActiveSceneHandlerReturn,
	InUnknownScene,
	PossibleInUnknownScene,
	SceneEnterHandler,
	SceneStepReturn,
	ScenesStorageData,
	StateTypesDefault,
} from "./types.js";

type ContextWithFrom = Pick<
	ContextType<Bot, "message" | "callback_query">,
	"from"
>;

export function getSceneEnter(
	context: ContextWithFrom,
	storage: Storage,
	key: string,
): SceneEnterHandler {
	return async (scene, ...args) => {
		const sceneParams: ScenesStorageData = {
			name: scene.name,
			state: {},
			params: args[0],
			stepId: 0,
			previousStepId: 0,
			firstTime: true,
		};
		await storage.set(key, sceneParams);
		// @ts-expect-error
		context.scene = getInActiveSceneHandler(
			context,
			storage,
			sceneParams,
			scene,
			key,
		);
		// @ts-expect-error
		await scene.compose(context, async () => {
			const sceneData = await storage.get<ScenesStorageData>(key);
			await storage.set(key, { ...sceneData, firstTime: false });
		});
	};
}

export function getSceneExit(
	storage: Storage,
	sceneData: ScenesStorageData,
	key: string,
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
	context: ContextWithFrom,
	storage: Storage,
	withCurrentScene: WithCurrentScene,
	scenes: AnyScene[],
): Promise<
	WithCurrentScene extends true ? PossibleInUnknownScene<any, any> : EnterExit
> {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	const enterExit = {
		enter: getSceneEnter(context, storage, key),
		exit: () => storage.delete(key),
	};

	if (withCurrentScene) {
		const sceneData =
			await storage.get<ScenesStorageData<unknown, unknown>>(key);

		// TODO: fix type issues. predicates are not smart for now
		// @ts-expect-error
		if (!sceneData) return enterExit;

		const scene = scenes.find((x) => x.name === sceneData.name);
		// @ts-expect-error
		if (!scene) return enterExit;

		return getPossibleInSceneHandlers(context, storage, sceneData, scene, key);
	}

	// @ts-expect-error
	return enterExit;
}

export function getInActiveSceneHandler<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextWithFrom,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: string,
): InActiveSceneHandlerReturn<Params, State> {
	const stepDerives = getStepDerives(context, storage, sceneData, scene, key);

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
		enter: getSceneEnter(context, storage, key),
		exit: getSceneExit(storage, sceneData, key),
		reenter: async () =>
			getSceneEnter(context, storage, key)(scene, sceneData.params),
	};
}

export function getStepDerives(
	context: ContextWithFrom,
	storage: Storage,
	storageData: ScenesStorageData<any, any>,
	scene: AnyScene,
	key: string,
): SceneStepReturn {
	async function go(stepId: number, firstTime = true) {
		storageData.previousStepId = storageData.stepId;
		storageData.stepId = stepId;
		storageData.firstTime = firstTime;
		// console.log("Oh we go to step", stepId);
		// await storage.set(key, storageData);
		//@ts-expect-error
		context.scene = getInActiveSceneHandler(
			context,
			storage,
			storageData,
			scene,
			key,
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
	context: ContextWithFrom,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: string,
): InUnknownScene<Params, State> {
	return {
		...getInActiveSceneHandler(context, storage, sceneData, scene, key),
		// @ts-expect-error
		is: (scene) => scene.name === sceneData.name,
	};
}

export function getPossibleInSceneHandlers<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextWithFrom,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: string,
): PossibleInUnknownScene<Params, State> {
	return {
		current: getInUnknownScene(context, storage, sceneData, scene, key),
		enter: getSceneEnter(context, storage, key),
		exit: getSceneExit(storage, sceneData, key),
		// @ts-expect-error PRIVATE KEY
		"~": {
			data: sceneData,
		},
	};
}
