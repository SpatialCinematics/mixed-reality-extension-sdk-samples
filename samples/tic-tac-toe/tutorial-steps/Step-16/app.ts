/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    Actor,
    AnimationKeyframe,
    AnimationWrapMode,
    ButtonBehavior,
    Context,
    ForwardPromise,
    PrimitiveShape,
    Quaternion,
    TextAnchorLocation,
    Vector3
} from '@microsoft/mixed-reality-extension-sdk';

enum GameState {
    Intro,
    Play,
    Celebration
}

enum GamePiece {
    X,
    O
}

/**
 * The main class of this app. All the logic goes here.
 */
export default class TicTacToe {
    private text: Actor = null;
    private textAnchor: Actor = null;

    private gameState: GameState;

    private currentPlayerGamePiece: GamePiece;
    private nextPlayerGamePiece: GamePiece;

    private boardState: GamePiece[];

    private gamePieceActors: Array<ForwardPromise<Actor>>;

    private victoryChecks = [
        [0 * 3 + 0, 0 * 3 + 1, 0 * 3 + 2],
        [1 * 3 + 0, 1 * 3 + 1, 1 * 3 + 2],
        [2 * 3 + 0, 2 * 3 + 1, 2 * 3 + 2],
        [0 * 3 + 0, 1 * 3 + 0, 2 * 3 + 0],
        [0 * 3 + 1, 1 * 3 + 1, 2 * 3 + 1],
        [0 * 3 + 2, 1 * 3 + 2, 2 * 3 + 2],
        [0 * 3 + 0, 1 * 3 + 1, 2 * 3 + 2],
        [2 * 3 + 0, 1 * 3 + 1, 0 * 3 + 2]
    ];

    constructor(private context: Context, private baseUrl: string) {
        this.context.onStarted(() => this.started());
    }

    /**
     * Once the context is "started", initialize the app.
     */
    private async started() {
        // Create a new actor with no mesh, but some text. This operation is asynchronous, so
        // it returns a "forward" promise (a special promise, as we'll see later).
        const textAnchorPromise = Actor.CreateEmpty(this.context, {
            actor: {
                name: 'TextAnchor',
                transform: {
                    position: { x: 0, y: 1.2, z: 0 }
                },
            }
        });
        this.textAnchor = textAnchorPromise.value;

        const textPromise = Actor.CreateEmpty(this.context, {
            actor: {
                parentId: this.textAnchor.id,
                name: 'Text',
                transform: {
                    position: { x: 0, y: 0.0, z: -1.5 }
                },
                text: {
                    contents: "Tic-Tac-Toe!",
                    anchor: TextAnchorLocation.MiddleCenter,
                    color: { r: 30 / 255, g: 206 / 255, b: 213 / 255 },
                    height: 0.3
                }
            }
        });

        // Even though the actor is not yet created in Altspace (because we didn't wait for the promise),
        // we can still get a reference to it by grabbing the `value` field from the forward promise.
        this.text = textPromise.value;

        // Here we create an animation on our text actor. Animations have three mandatory arguments:
        // a name, an array of keyframes, and an array of events.
        const textAnimationPromise = this.textAnchor.createAnimation({
            // The name is a unique identifier for this animation. We'll pass it to "startAnimation" later.
            animationName: "Spin",
            // Keyframes define the timeline for the animation: where the actor should be, and when.
            // We're calling the generateSpinKeyframes function to produce a simple 20-second revolution.
            keyframes: this.generateSpinKeyframes(20, Vector3.Up()),
            // Events are points of interest during the animation. The animating actor will emit a given
            // named event at the given timestamp with a given string value as an argument.
            events: [],

            // Optionally, we also repeat the animation infinitely.
            wrapMode: AnimationWrapMode.Loop
        }).catch(reason => console.log(`Failed to create spin animation: ${reason}`));

        // TODO: This shouldn't be necessary as playanimation should be awaiting the textanimation first.
        await textAnimationPromise;

        for (let tileIndexX = 0; tileIndexX < 3; tileIndexX++) {
            for (let tileIndexZ = 0; tileIndexZ < 3; tileIndexZ++) {
                // Load a glTF model
                const cubePromise = Actor.CreateFromGLTF(this.context, {
                    // at the given URL
                    resourceUrl: `${this.baseUrl}/altspace-cube.glb`,
                    // and spawn box colliders around the meshes.
                    colliderType: 'box',
                    // Also apply the following generic actor properties.
                    actor: {
                        name: 'Altspace Cube',
                        transform: {
                            position: { x: (tileIndexX) - 1.0, y: 0.5, z: (tileIndexZ) - 1.0 },
                            scale: { x: 0.4, y: 0.4, z: 0.4 }
                        }
                    }
                });

                // Grab that early reference again.
                const cube = cubePromise.value;

                // Create some animations on the cube.
                cube.createAnimation({
                    animationName: 'GrowIn',
                    keyframes: this.growAnimationData,
                    events: []
                }).catch(reason => console.log(`Failed to create grow animation: ${reason}`));

                cube.createAnimation({
                    animationName: 'ShrinkOut',
                    keyframes: this.shrinkAnimationData,
                    events: []
                }).catch(reason => console.log(`Failed to create shrink animation: ${reason}`));

                cube.createAnimation({
                    animationName: 'DoAFlip',
                    keyframes: this.generateSpinKeyframes(1.0, Vector3.Right()),
                    events: []
                }).catch(reason => console.log(`Failed to create flip animation: ${reason}`));

                // Set up cursor interaction. We add the input behavior ButtonBehavior to the cube.
                // Button behaviors have two pairs of events: hover start/stop, and click start/stop.
                const buttonBehavior = cube.setBehavior(ButtonBehavior);

                // Trigger the grow/shrink animations on hover.
                buttonBehavior.onHover('enter', (userId: string) => {
                    if (this.gameState === GameState.Play &&
                        this.boardState[tileIndexX * 3 + tileIndexZ] === undefined) {
                        cube.startAnimation('GrowIn');
                    }
                });
                buttonBehavior.onHover('exit', (userId: string) => {
                    if (this.gameState === GameState.Play &&
                        this.boardState[tileIndexX * 3 + tileIndexZ] === undefined) {
                        cube.startAnimation('ShrinkOut');
                    }
                });

                buttonBehavior.onClick('pressed', (userId: string) => {
                    switch (this.gameState) {
                        case GameState.Intro:
                            this.beginGameStatePlay();
                            break;
                        case GameState.Play:
                            // When clicked, put down a tile, and do a victory check
                            if (this.boardState[tileIndexX * 3 + tileIndexZ] === undefined) {
                                console.log("Putting an " + GamePiece[this.currentPlayerGamePiece] +
                                    " on: (" + tileIndexX + "," + tileIndexZ + ")");
                                const gamePiecePosition: Vector3 = new Vector3(
                                    cube.transform.position.x,
                                    cube.transform.position.y + 0.55,
                                    cube.transform.position.z);
                                if (this.currentPlayerGamePiece === GamePiece.O) {
                                    this.gamePieceActors.push(Actor.CreatePrimitive(this.context, {
                                        definition: {
                                            shape: PrimitiveShape.Cylinder,
                                            dimensions: { x: 0, y: 0.2, z: 0 },
                                            radius: 0.4,
                                            uSegments: 16,
                                        },
                                        actor: {
                                            name: 'O',
                                            transform: {
                                                position: gamePiecePosition
                                            }
                                        }
                                    }));
                                } else {
                                    this.gamePieceActors.push(Actor.CreatePrimitive(this.context, {
                                        definition: {
                                            shape: PrimitiveShape.Box,
                                            dimensions: { x: 0.70, y: 0.2, z: 0.70 }
                                        },
                                        actor: {
                                            name: 'X',
                                            transform: {
                                                position: gamePiecePosition
                                            }
                                        }
                                    }));
                                }
                                this.boardState[tileIndexX * 3 + tileIndexZ] = this.currentPlayerGamePiece;
                                cube.stopAnimation('GrowIn');
                                cube.startAnimation('ShrinkOut');

                                const tempGamePiece = this.currentPlayerGamePiece;
                                this.currentPlayerGamePiece = this.nextPlayerGamePiece;
                                this.nextPlayerGamePiece = tempGamePiece;

                                this.text.text.contents = "Next Piece: " + GamePiece[this.currentPlayerGamePiece];

                                for (const victoryCheck of this.victoryChecks) {
                                    if (this.boardState[victoryCheck[0]] !== undefined &&
                                        this.boardState[victoryCheck[0]] === this.boardState[victoryCheck[1]] &&
                                        this.boardState[victoryCheck[0]] === this.boardState[victoryCheck[2]]) {
                                        this.beginGameStateCelebration(tempGamePiece);
                                        break;
                                    }
                                }

                                let hasEmptySpace = false;
                                for (let i = 0; i < 3 * 3; i++) {
                                    if (this.boardState[i] === undefined) {
                                        hasEmptySpace = true;
                                    }
                                }
                                if (hasEmptySpace === false) {
                                    this.beginGameStateCelebration(undefined);
                                }
                            }
                            break;
                        case GameState.Celebration:
                        default:
                            this.beginGameStateIntro();
                            break;
                    }
                });
            }
        }
        // Now that the text and its animation are all being set up, we can start playing
        // the animation.
        this.textAnchor.startAnimation('Spin');
        this.beginGameStateIntro();
    }

    private beginGameStateCelebration(winner: GamePiece) {
        console.log("BeginGameState Celebration");
        this.gameState = GameState.Celebration;

        if (winner === undefined) {
            console.log("Tie");
            this.text.text.contents = "Tie";
        } else {
            console.log("Winner: " + GamePiece[winner]);
            this.text.text.contents = "Winner: " + GamePiece[winner];
        }
    }

    private beginGameStateIntro() {
        console.log("BeginGameState Intro");
        this.gameState = GameState.Intro;
        this.text.text.contents = "Tic-Tac-Toe\nClick To Play";

        this.currentPlayerGamePiece = GamePiece.X;
        this.nextPlayerGamePiece = GamePiece.O;
        this.boardState = [];

        if (this.gamePieceActors !== undefined) {
            for (const actor of this.gamePieceActors) {
                actor.value.destroy();
            }
        }
        this.gamePieceActors = [];
    }

    private beginGameStatePlay() {
        console.log("BeginGameState Play");
        this.gameState = GameState.Play;
        this.text.text.contents = "First Piece: " + GamePiece[this.currentPlayerGamePiece];
    }

    /**
     * Generate keyframe data for a simple spin animation.
     * @param duration The length of time in seconds it takes to complete a full revolution.
     * @param axis The axis of rotation in local space.
     */
    private generateSpinKeyframes(duration: number, axis: Vector3): AnimationKeyframe[] {
        return [{
            time: 0 * duration,
            value: { transform: { rotation: Quaternion.RotationAxis(axis, 0) } }
        }, {
            time: 0.25 * duration,
            value: { transform: { rotation: Quaternion.RotationAxis(axis, Math.PI / 2) } }
        }, {
            time: 0.5 * duration,
            value: { transform: { rotation: Quaternion.RotationAxis(axis, Math.PI) } }
        }, {
            time: 0.75 * duration,
            value: { transform: { rotation: Quaternion.RotationAxis(axis, 3 * Math.PI / 2) } }
        }, {
            time: 1 * duration,
            value: { transform: { rotation: Quaternion.RotationAxis(axis, 2 * Math.PI) } }
        }];
    }

    private growAnimationData: AnimationKeyframe[] = [{
        time: 0,
        value: { transform: { scale: { x: 0.4, y: 0.4, z: 0.4 } } }
    }, {
        time: 0.3,
        value: { transform: { scale: { x: 0.5, y: 0.5, z: 0.5 } } }
    }];

    private shrinkAnimationData: AnimationKeyframe[] = [{
        time: 0,
        value: { transform: { scale: { x: 0.5, y: 0.5, z: 0.5 } } }
    }, {
        time: 0.3,
        value: { transform: { scale: { x: 0.4, y: 0.4, z: 0.4 } } }
    }];
}
