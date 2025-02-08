const express = require('express');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

let IDSklep = ''; 
let sklepName = ''; 

let IDZapas = ''; 
let cachedDataZapas = null;
let cachedDataKontrolaZwrotu = null;

const keys = {
    client_email: process.env.CLIENT_EMAIL,
    private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    userSheetId: process.env.USER_SHEET_ID
};

const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

async function getSheetData(spreadsheetId, range) {
    const gsapi = google.sheets({ version: 'v4', auth: client });
    const opt = { spreadsheetId, range };
    let data = await gsapi.spreadsheets.values.get(opt);
    return data.data.values;
}

// Załaduj dane z arkusza "Zapas" i "Kontrola zwrotu" do pamięci podręcznej
async function loadDataToCache() {
    try {
        const zapasData = await getSheetData(IDZapas, 'Baza!A:D');
        cachedDataZapas = zapasData.slice(1).map(row => [row[0], row[1], row[2], row[3]]); // Zapisz dane bez nagłówków

        const kontrolaData = await getSheetData(IDSklep, 'Kontrola zwrotu!A1:G');
        cachedDataKontrolaZwrotu = kontrolaData.slice(1).map(row => [row[0], row[1], row[2], row[4], row[3], row[5]]); // Zapisz dane bez nagłówków
        console.log('Dane zostały załadowane do pamięci.');
    } catch (error) {
        console.error('Błąd podczas ładowania danych:', error);
    }
}

// Załaduj dane przy starcie serwera
loadDataToCache();

// Endpoint logowania
app.post('/login', async (req, res) => {
    try {
        const username = req.body.username;
        const userRange = 'Użytkownik!A:B';

        const userData = await getSheetData(keys.userSheetId, userRange);
        const userRow = userData.find(row => row[0] === username);

        if (userRow) {
            sklepName = userRow[1];
            const shopRange = 'Sklep!A:C';
            const shopData = await getSheetData(keys.userSheetId, shopRange);
            const shopRow = shopData.find(row => row[0] === sklepName);

            if (shopRow) {
                IDSklep = shopRow[1]; 
                IDZapas = shopRow[2]; 

                // Ładowanie danych do pamięci po logowaniu
                await loadDataToCache();

                res.json({ success: true, sklep: sklepName });
            } else {
                res.json({ success: false, message: 'Sklep nie znaleziony' });
            }
        } else {
            res.json({ success: false, message: 'Nieprawidłowa nazwa użytkownika' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Wystąpił błąd podczas logowania' });
    }
});

// Endpoint wylogowania
app.post('/logout', (req, res) => {
    try {
        IDSklep = '';
        sklepName = '';
        IDZapas = '';
        cachedDataZapas = null;
        cachedDataKontrolaZwrotu = null;
        res.json({ success: true, message: 'Wylogowano pomyślnie' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas wylogowywania' });
    }
});

// Endpoint pobierania danych o sklepie
app.get('/sklepName', (req, res) => {
    res.json({ sklepName });
});

// Endpoint do wyszukiwania w arkuszu zapasu
app.get('/searchZapas', async (req, res) => {
    try {
        const searchInput = req.query.searchInput.trim();

        if (!cachedDataZapas) {
            return res.status(500).json({ error: 'Brak danych w pamięci. Spróbuj ponownie później.' });
        }

        const matchingData = cachedDataZapas.filter(row => 
            row.some(cell => cell && cell.toString() === searchInput)
        );

        const responseData = { 
            headers: ['Kolumna A', 'Kolumna B', 'Kolumna C', 'Kolumna D'], // Nagłówki dla danych
            filteredData: matchingData
        };

        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: 'Wystąpił błąd podczas wyszukiwania danych zapasu.' });
    }
});

// Endpoint do aktualizacji ilości
app.post('/updateQuantity', async (req, res) => {
    try {
        const { searchInput, quantity } = req.body;
        const spreadsheetId = IDSklep;
        const range = 'Zamówienia suma!A:K';

        const sheetData = await getSheetData(spreadsheetId, range);
        const rowIndex = sheetData.findIndex(row => row[0] === searchInput || row[1] === searchInput);

        if (rowIndex === -1) {
            return res.json({ success: false, message: 'Nie znaleziono danych w Arkusz2.' });
        }

        const existingQuantity = parseFloat(sheetData[rowIndex][10]) || 0;
        const newQuantity = existingQuantity + quantity;

        await google.sheets({ version: 'v4', auth: client }).spreadsheets.values.update({
            spreadsheetId,
            range: `Zamówienia suma!K${rowIndex + 1}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newQuantity]] },
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Wystąpił błąd podczas aktualizacji ilości.' });
    }
});

// Endpoint do zapisywania danych do arkusza
app.post('/saveToSheet', async (req, res) => {
    try {
        const { paletaNumber, rowData, quantity } = req.body;
        const spreadsheetId = IDZapas;
        const rangeToCheck = 'Zapas!A:A';
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const columnData = await gsapi.spreadsheets.values.get({
            spreadsheetId,
            range: rangeToCheck,
        });

        const firstEmptyRow = columnData.data.values ? columnData.data.values.length + 1 : 1;
        const newRow = [paletaNumber, ...rowData, quantity];

        await gsapi.spreadsheets.values.update({
            spreadsheetId,
            range: `Zapas!A${firstEmptyRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
        });

        // Po zapisaniu nowych danych odśwież dane w pamięci
        await loadDataToCache();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas zapisu do Arkusza3.' });
    }
});

// Endpoint do pobrania nazwy sklepu
app.get('/getShopName', (req, res) => {
    res.json({ shopName: sklepName });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serwer działa na porcie ${PORT}`);
});
