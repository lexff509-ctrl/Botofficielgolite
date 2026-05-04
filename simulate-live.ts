
import { generateSignal, type Candle } from './src/lib/trading';

/**
 * SIMULATION DE TEST EN DIRECT
 * Ce script simule un environnement de marché réel pour tester l'intelligence du bot
 * et sa capacité à alterner entre CALL et PUT sur 5 trades.
 */
async function simulateLiveTrading() {
    console.log("🚀 Lancement de la Simulation de Test en Direct...");
    console.log("--------------------------------------------------");

    let currentPrice = 1.08500;
    const history: Candle[] = [];
    
    // Initialisation de 100 bougies de base
    for (let i = 0; i < 100; i++) {
        currentPrice += (Math.random() - 0.5) * 0.0001;
        history.push({
            timestamp: Date.now() - (100 - i) * 1000,
            open: currentPrice,
            close: currentPrice,
            high: currentPrice + 0.00005,
            low: currentPrice - 0.00005,
            volume: 100
        });
    }

    const tradeResults = [];

    // Simulation de 5 cycles de décision
    for (let t = 1; t <= 5; t++) {
        console.log(`\n[Trade #${t}] Analyse du marché...`);
        
        // Simuler une variation de prix pour influencer le signal
        // Alterne entre tendance haussière et baissière pour forcer la diversité
        const trend = t % 2 === 0 ? 0.0005 : -0.0005;
        for (let j = 0; j < 5; j++) {
            currentPrice += trend + (Math.random() - 0.5) * 0.0001;
            history.push({
                timestamp: Date.now(),
                open: history[history.length-1].close,
                close: currentPrice,
                high: currentPrice + 0.00002,
                low: currentPrice - 0.00002,
                volume: 100
            });
            if (history.length > 200) history.shift();
        }

        const signal = generateSignal(history, "EURUSD_otc", "1m");
        
        if (signal) {
            console.log(`✅ SIGNAL GÉNÉRÉ : ${signal.direction} | Confiance : ${signal.confidence}`);
            console.log(`📊 Diagnostic : ${signal.diagnostic}`);
            
            // Simulation de l'exécution
            console.log(`⚡ Exécution en temps réel sur PocketOption...`);
            await new Promise(r => setTimeout(r, 800)); // Simule latence réseau
            
            const isWin = Math.random() > 0.35; // 65% de winrate simulé
            console.log(`🎯 Résultat : ${isWin ? 'GAGNÉ (WIN)' : 'PERDU (LOSS)'}`);
            tradeResults.push({ direction: signal.direction, result: isWin ? 'WIN' : 'LOSS' });
        } else {
            console.log("⚠️ Aucun signal clair détecté par l'analyse technique.");
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log("\n--------------------------------------------------");
    console.log("🏁 BILAN DE LA SIMULATION :");
    const calls = tradeResults.filter(r => r.direction === 'CALL').length;
    const puts = tradeResults.filter(r => r.direction === 'PUT').length;
    
    console.log(`- Total trades : ${tradeResults.length}`);
    console.log(`- Directions : ${calls} CALL / ${puts} PUT`);
    
    if (calls > 0 && puts > 0) {
        console.log("✅ TEST RÉUSSI : Le bot a démontré une analyse multidirectionnelle.");
    } else {
        console.warn("⚠️ AVERTISSEMENT : Le bot est resté sur une seule direction. La stratégie pourrait être trop rigide.");
    }
}

simulateLiveTrading().catch(console.error);
