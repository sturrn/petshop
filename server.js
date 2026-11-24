require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken")
const cookieParser = require("cookie-parser");
const path = require("path");
const { truncateSync } = require("fs");
const app = express();
app.set("trust proxy", 1) //codigo novo implementado
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")))
app.use(cookieParser());

const ssl = process.env.DB_SSL_CA ? {ca: process.env.DB_SSL_CA.replace(/\\n/), rejectUnauthorized: true}: {rejectUnauthorized: truncateSync}

const db = mysql.createPool({
    host: process.env.HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl : ssl,
    waitForConnections : true,
    connectionLimit: 5,
    queueLimit: 0
})

async function criarBanco(){
    await db.execute(`CREATE TABLE IF NOT EXISTS atendimento(
        id INT PRIMARY KEY AUTO_INCREMENT,
        tutor VARCHAR(100) NOT NULL,
        pet VARCHAR(100) NOT NULL,
        especie ENUM('Cachorro', 'Gato', 'Outro') NOT NULL,
        servico VARCHAR(100) NOT NULL,
        valor DECIMAL (10,2) NOT NULL,
        data_atendimento DATE NOT NULL,
        criacao_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )ENGINE =InnoDB`)

        await db.execute(`CREATE TABLE IF NOT EXISTS usuario(
            id INT PRIMARY KEY AUTO_INCREMENT,
            email VARCHAR(70) NOT NULL UNIQUE,
            senha VARCHAR(255) NOT NULL
            )ENGINE =InnoDB`)
            iniciar()
}

async function iniciar() {
    try {
        const [usuario] = await db.execute("SELECT * FROM usuario WHERE email = ?", [process.env.ADMIN_EMAIL])
        if (usuario.length === 0) {
            const senhaHash = await bcrypt.hash(process.env.ADMIN_SENHA, 10)
            await db.execute("INSERT INTO usuario (email, senha) VALUES (?, ?)", [process.env.ADMIN_EMAIL, senhaHash]);
            console.log("Usuário administrador criado com sucesso.")
        }
    } catch (erro) {
        console.log("Não foi possivel conectar ao banco de dados .")
    }

}

app.post("/api/atendimento", async (req, res) => {
    try {
        const { tutor, pet, especie, servico, valor, data } = req.body;
        if (!tutor || !pet || !especie || !servico || !Number(valor) || !data) {
            return res.status(400).json({ erro: "Confira todos os campos" })
        }
        if (valor <= 0) {
            return res.status(400).json({ erro: 'valor deve ser maior que 0.' })
        }
        const [resultado] = await db.execute(
            `INSERT INTO atendimento
            (tutor, pet, especie, servico, valor,data_atendimento) VALUES (?,?,?,?,?,?)`, [tutor.trim(), pet.trim(), especie, servico, Number(valor), data]
        )
        res.status(201).json({ mensagem: "Atendimento salvo!", id: resultado.insertId })
    } catch (erro) {
        console.log(erro)
        res.status(500).json({ erro: "erro de conexão com o banco" })
    }
})

app.post("/api/login", async (req, res) => {
    try {
        const { email, senha } = req.body;
        if (!email || !senha) {
            return res.status(400).json({ erro: "Preencha todos os campos" })
        }
        const [usuario] = await db.execute("SELECT * FROM usuario WHERE email = ?", [email.trim()]);
        if (usuario.length === 0) {
            return res.status(401).json({ erro: "Email ou senha incorretos" })
        }
        const dados = usuario[0];
        const senhaCorreta = await bcrypt.compare(senha, dados.senha);
        if (!senhaCorreta) {
            return res.status(401).json({ erro: "Email ou senha incorretos" })
        }
        const token = jwt.sign({ id: dados.id, email: dados.email },
            process.env.JWT_SEGREDO, { expiresIn: "1h" })
        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE === "production", sameSite: "strict", maxAge: 3600000 })

        res.json({ mensagem: "Login realizado com sucesso!" })
    } catch (erro) {
        console.log(erro)
        res.status(500).json({ erro: "Erro de conexão com o banco" })
    }
});

function autenticar(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ erro: "Acesso negado" })
    }
    try {
        req.usuario = jwt.verify(token, process.env.JWT_SEGREDO);
        next();
    } catch (erro) {
        res.clearCookie("token")
        res.redirect("/login.html")
        return res.status(401).json({
            erro: "Sessão inválida ou expirada."
        })
    }
}

app.get("/dashboard", autenticar, (req, res) => {
    res.sendFile(path.join(__dirname, "private", "dashboard.html"))
})

app.get("/api/verificar", autenticar, (req, res) => {
    res.json({ mensagem: "Usuário autenticado", usuario: req.usuario })
})

app.post("/api/logout", (req, res) => {
    res.clearCookie("token", { httpOnly: true, sameSite: "strict", secure: process.env.NODE === "production" })
    res.json({ mensagem: "logout efetuado" })
})

async function conectarPython(endpoint, atendimento,res, tipo){
    try{
    const url = process.env.PYTHON_API_URL
    const resposta = await fetch(`${url.replace(/\/$/, "")}${endpoint}`,{
        method:"POST",
        headers: { "Content-Type": "application/json"},
        body: JSON.stringify({atendimento})
    })
    if(!resposta.ok){
        throw new Error(resposta.status)
    }
    const arquivo = Buffer.from(await resposta.arrayBuffer());
    if(tipo === "pdf"){
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", "attchment; filename = 'relatorio-petshop.pdf'")
    }else {
        res.setHeader("Content-Type", "image/png")
        res.setHeader("Content-Disposition", "inline; filename = graficos.png")
    }
    res.send(arquivo);
}catch(erro){
    console.log(erro)
    res.status(502).json({erro:"Não foi possivekl conectar ao servidor python!!!"})
}
}



app.get("/api/graficos", autenticar, async (req, res) => {
    try {
        const [atendimento] = await db.execute(`SELECT tutor, pet, especie, servico FROM atendimento`)
        await conectarPython("/graficos", atendimento, res, "imagem")
    } catch (erro) {
        res.status(500).json({ erro: "erro de comunicacao com o python" })
    }
})

app.get("/api/pdf", autenticar, async (req, res) => {
    try {
        const [atendimento] = await db.execute(`
        SELECT tutor, pet, especie, servico FROM atendimento ORDER BY data_atendimento
    `)
       await conectarPython("/pdf", atendimento, res, "pdf")
    } catch (erro) {
        res.status(500).json({ erro: "Erro de comunicação com o Python" })
    }
})

const PORT = process.env.PORT || 3000
criarBanco()
.then(()=> app.listen(process.env.PORT, "0.0.0.0", ()=> console.log("Servidor rodando")))
.catch((erro) => {
    console.log(erro)
    process.exit(1)
})