import User from "../models/User.js";
import Prediction from "../models/Prediction.js";
import { getCache, setCache } from "../services/cache.service.js";

export const getLeaderboard = async (req, res) => {
    try {
        const cached = getCache("leaderboard");
        if (cached) return res.status(200).json(cached);

        const [users, predictions] = await Promise.all([
            User.find({ isActive: true }).select("name username totalPoints"),
            Prediction.find({ calculated: true }).select("user points"),
        ]);

        const predictionsByUser = {};
        for (const p of predictions) {
            const uid = p.user.toString();
            if (!predictionsByUser[uid]) predictionsByUser[uid] = [];
            predictionsByUser[uid].push(p);
        }

        const leaderboard = users
            .map((user) => {
                const userPredictions = predictionsByUser[user._id.toString()] || [];
                return {
                    id: user._id,
                    name: user.name,
                    username: user.username,
                    totalPoints: user.totalPoints,
                    exactResults: userPredictions.filter((p) => p.points === 3).length,
                    correctWinner: userPredictions.filter((p) => p.points === 1).length,
                };
            })
            .sort((a, b) => {
                if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
                if (b.exactResults !== a.exactResults) return b.exactResults - a.exactResults;
                if (b.correctWinner !== a.correctWinner) return b.correctWinner - a.correctWinner;
                return a.name.localeCompare(b.name);
            })
            .map((user, i) => ({ position: i + 1, ...user }));

        const response = { leaderboard };
        setCache("leaderboard", response);

        res.status(200).json(response);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error al obtener el ranking" });
    }
};

export const getGroupStageLeaderboard = async (req, res) => {
    try {
        const cached = getCache("leaderboard:group-stage");
        if (cached) return res.status(200).json(cached);

        const predictions = await Prediction.find({
            calculated: true
        })
            .populate("user", "name username isActive")
            .populate("match", "stage matchday");

        const result = {};

        for (let matchday = 1; matchday <= 3; matchday++) {
            const matchdayPredictions = predictions.filter((prediction) => {
                return (
                    prediction.user?.isActive &&
                    prediction.match?.stage === "GROUP_STAGE" &&
                    prediction.match?.matchday === matchday
                );
            });

            const usersMap = {};

            for (const prediction of matchdayPredictions) {
                const userId = prediction.user._id.toString();

                if (!usersMap[userId]) {
                    usersMap[userId] = {
                        id: prediction.user._id,
                        name: prediction.user.name,
                        username: prediction.user.username,
                        points: 0,
                        exactResults: 0
                    };
                }

                usersMap[userId].points += prediction.points;

                if (prediction.points === 3) {
                    usersMap[userId].exactResults += 1;
                }
            }

            const usersArray = Object.values(usersMap);

            const byPoints = [...usersArray]
                .sort((a, b) => {
                    if (b.points !== a.points) return b.points - a.points;
                    return b.exactResults - a.exactResults;
                })
                .map((user, index) => ({
                    position: index + 1,
                    ...user
                }));

            const byExactResults = [...usersArray]
                .sort((a, b) => {
                    if (b.exactResults !== a.exactResults) {
                        return b.exactResults - a.exactResults;
                    }

                    return b.points - a.points;
                })
                .map((user, index) => ({
                    position: index + 1,
                    ...user
                }));

            result[`matchday${matchday}`] = {
                byPoints,
                byExactResults
            };
        }

        setCache("leaderboard:group-stage", result);
        res.status(200).json(result);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error al obtener ranking por fechas" });
    }
};