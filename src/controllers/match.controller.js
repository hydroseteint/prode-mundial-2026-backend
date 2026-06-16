import Match from "../models/Match.js";
import { getWorldCupMatchesFromApi } from "../services/footballApi.service.js";
import Prediction from "../models/Prediction.js";
import { getCache, setCache } from "../services/cache.service.js";

export const syncMatches = async (req, res) => {
    try {
        const matches = await getWorldCupMatchesFromApi();

        let createdOrUpdated = 0;

        for (const apiMatch of matches) {
            await Match.findOneAndUpdate(
                {apiMatchId: apiMatch.id},
                {
                    apiMatchId: apiMatch.id,
                    homeTeam: apiMatch.homeTeam?.name || "Por definir",
                    awayTeam: apiMatch.awayTeam?.name || "Por definir",
                    homeTeamShortName: apiMatch.homeTeam?.shortName || "",
                    awayTeamShortName: apiMatch.awayTeam?.shortName || "",
                    startDate: apiMatch.utcDate,
                    status: apiMatch.status,
                    stage: apiMatch.stage,
                    group: apiMatch.group,
                    matchday: apiMatch.matchday,
                    homeGoals: apiMatch.score?.fullTime?.home ?? null,
                    awayGoals: apiMatch.score?.fullTime?.away ?? null,
                    winner: apiMatch.score?.winner ?? null
                },
                {
                    upsert: true,
                    new: true
                }
            );

            createdOrUpdated++;
        }

        res.status(200).json({
            message: "Partidos sincronizados correctamente",
            total: createdOrUpdated
        })

    } catch (error) {
        console.log(error);
        
        res.status(500).json({
            message: "Error al sincronizar los partidos"
        });
    }
}

export const getMatches = async (req, res) => {
    try {
        const matches = await Match.find().sort({ startDate: 1 });

        res.status(200).json({
            matches
        });

    } catch (error) {
        res.status(500).json({
            message: "Error al obtener partidos"
        });
    }
};

export const getMatchesWithUserPredictions = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 10;
        const skip = (page - 1) * limit;
        const { status = "all", journey = "all" } = req.query;

        const now = new Date();
        const matchQuery = {};

        if (journey === "matchday-1") { matchQuery.stage = "GROUP_STAGE"; matchQuery.matchday = 1; }
        else if (journey === "matchday-2") { matchQuery.stage = "GROUP_STAGE"; matchQuery.matchday = 2; }
        else if (journey === "matchday-3") { matchQuery.stage = "GROUP_STAGE"; matchQuery.matchday = 3; }
        else if (journey === "knockout") { matchQuery.stage = { $ne: "GROUP_STAGE" }; }

        if (status === "closed") {
            matchQuery.startDate = { $lte: now };
        } else {
            // "all", "pending", "predicted" solo muestran partidos abiertos
            matchQuery.startDate = { $gt: now };
            if (status === "pending" || status === "predicted") {
                const userPredictions = await Prediction.find({ user: req.user._id }).select("match");
                const predictedMatchIds = userPredictions.map((p) => p.match);
                matchQuery._id = status === "pending"
                    ? { $nin: predictedMatchIds }
                    : { $in: predictedMatchIds };
            }
        }

        const sortOrder = status === "closed" ? { startDate: -1 } : { startDate: 1 };

        const [total, matches] = await Promise.all([
            Match.countDocuments(matchQuery),
            Match.find(matchQuery).sort(sortOrder).skip(skip).limit(limit),
        ]);

        const matchIds = matches.map((m) => m._id);
        const predictions = await Prediction.find({ user: req.user._id, match: { $in: matchIds } });

        const matchesWithPredictions = matches.map((match) => {
            const prediction = predictions.find((p) => p.match.toString() === match._id.toString());
            return {
                ...match.toObject(),
                prediction: prediction || null,
                predictionClosed: now >= match.startDate,
            };
        });

        res.status(200).json({
            matches: matchesWithPredictions,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Error al obtener partidos con predicciones"
        });
    }
};

export const getNextArgentinaMatch = async (req, res) => {
    try {
        const cached = getCache("matches:next-argentina");
        if (cached) return res.status(200).json(cached);

        const match = await Match.findOne({
            status: "TIMED",
            $or: [
                { homeTeam: "Argentina" },
                { awayTeam: "Argentina" }
            ]
        }).sort({ startDate: 1 });

        const response = { match };
        setCache("matches:next-argentina", response);
        res.status(200).json(response);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error al obtener próximo partido de Argentina" });
    }
};

export const getTodayMatches = async (req, res) => {
    try {
        const cached = getCache("matches:today");
        if (cached) return res.status(200).json(cached);

        const now = new Date();
        const offsetMs = -3 * 60 * 60 * 1000; // UTC-3 Argentina
        const localNow = new Date(now.getTime() + offsetMs);
        const localDateStr = localNow.toISOString().slice(0, 10); // "YYYY-MM-DD"

        const startOfDay = new Date(`${localDateStr}T00:00:00.000-03:00`);
        const endOfDay = new Date(`${localDateStr}T23:59:59.999-03:00`);

        const matches = await Match.find({
            startDate: { $gte: startOfDay, $lte: endOfDay }
        }).sort({ startDate: 1 });

        const upcomingMatches = await Match.find({
            status: "TIMED",
            startDate: { $gt: endOfDay }
        })
            .sort({ startDate: 1 })
            .limit(5);

        const response = { matches, upcomingMatches };

        setCache("matches:today", response);
        res.status(200).json(response);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error al obtener partidos de hoy" });
    }
};