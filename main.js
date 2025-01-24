const express = require('express');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

let IDSklep = ''; 
let sklepName = ''; 
let IDZapas = ''; 

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
                
                const supplierData = await getSheetData(IDSklep, 'Kontrola zwrotu!I2:I2');
                const returnPolicyData = await getSheetData(IDSklep, 'Kontrola zwrotu!J2:J2');
                const supplier = supplierData[0][0] || 'Brak danych';
                const returnPolicy = returnPolicyData[0][0] || 'Brak danych';

                res.json({ success: true, sklep: sklepName, supplier, returnPolicy });
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

app.get('/sklepName', (req, res) => {
    res.json({ sklepName });
});

app.post('/logout', (req, res) => {
    try {
        IDSklep = '';
        sklepName = '';
        IDZapas = '';
        res.json({ success: true, message: 'Wylogowano pomyślnie' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas wylogowywania' });
    }
});

app.get('/search', async (req, res) => {
    try {
        const searchInput = req.query.searchInput.toLowerCase();
        const data = await getSheetData(IDSklep, 'Kontrola zwrotu!A1:G');
        const returnPolicyData = await getSheetData(IDSklep, 'Kontrola zwrotu!J2:J2');

        const headers = [data[0][0], data[0][1], data[0][2], data[0][4], data[0][3], data[0][5], data[0][6]];
        const filteredData = data.slice(1).map(row => [row[0], row[1], row[2], row[4], row[3], row[5]]);

        const matchingData = filteredData.filter(row => 
            (row[0] && row[0].toLowerCase() === searchInput) || 
            (row[1] && row[1].toLowerCase() === searchInput)
        );

        const responseData = { 
            headers, 
            filteredData: matchingData, 
            returnValue: returnPolicyData[0][0] || 'Brak danych' 
        };

        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: 'Wystąpił błąd podczas wyszukiwania danych' });
    }
});

app.get('/searchZapas', async (req, res) => {
    try {
        const searchInput = req.query.searchInput.trim();
        const data = await getSheetData(IDZapas, 'Baza!A:D'); 

        // Uwzględnij kolumnę A w nagłówkach i danych
        const headers = [data[0][0], data[0][1], data[0][2], data[0][3]];
        const filteredData = data.slice(1).map(row => [row[0], row[1], row[2], row[3]]);

        // Filtruj również według kolumny A
        const matchingData = filteredData.filter(row => 
            row.some(cell => cell && cell.toString() === searchInput)
        );

        const responseData = { 
            headers, 
            filteredData: matchingData
        };

        res.json(responseData);
    } catch (error) {
        res.status(500).json({ error: 'Wystąpił błąd podczas wyszukiwania danych zapasu.' });
    }
});


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

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas zapisu do Arkusza3.' });
    }
});

app.get('/getShopName', (req, res) => {
    res.json({ shopName: sklepName });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT);
