const express = require("express");
const cors = require("cors");
const stripe = require("stripe")("sk_test_51Re2DXIGnSq3aVjyz6bGfgnrCIdej1KFBgimhnVaMUsafC2wz1zkRAEq9v5sdeR5bRsH57dkfkFBRUPkYgdTmSAB003OUjspVp"); // sua sk_test_

const app = express();
app.use(cors()); // permite requisições do frontend
app.use(express.json());

app.post("/create-payment-intent", async (req, res) => {
    const { amount } = req.body;

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "brl",
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));
