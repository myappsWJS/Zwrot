const express = require('express');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const path = require('path');
const keys = require('./keys.json');
const app = express();

let IDSklep = ''; // Globalna zmienna do przechowywania ID sklepu
let sklepName = ''; // Przechowuje nazwę sklepu
let IDZapas =''; //Globalna zmienna przechowująca ID Zapas

// Pobieranie ID login z keys.json
const userSheetId = keys.userSheetId; // Wartość ID arkusza loginu z pliku JSON

// Uwierzytelnienie
const client = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
);

// Middleware do parsowania JSON
app.use(bodyParser.json());

// Serwowanie pliku HTML i statycznych plików
app.use(express.static(path.join(__dirname, 'public')));

// Funkcja do pobierania danych z Google Sheets
async function getSheetData(spreadsheetId, range) {
    const gsapi = google.sheets({ version: 'v4', auth: client });
    const opt = { spreadsheetId, range };
    let data = await gsapi.spreadsheets.values.get(opt);
    return data.data.values;
}

// Endpoint do logowania użytkownika
app.post('/login', async (req, res) => {
    try {
        const username = req.body.username;
        const userRange = 'Użytkownik!A:B';

        const userData = await getSheetData(userSheetId, userRange);
        const userRow = userData.find(row => row[0] === username);

        if (userRow) {
            sklepName = userRow[1]; // Przypisujemy nazwę sklepu do zmiennej globalnej
            const shopRange = 'Sklep!A:C';
            const shopData = await getSheetData(userSheetId, shopRange);
            const shopRow = shopData.find(row => row[0] === sklepName);

            if (shopRow) {
                IDSklep = shopRow[1]; // Przypisanie ID sklepu do globalnej zmiennej
                IDZapas = shopRow[2]; //Przypisanie ID zapasu do globalnej zmiennej 
                
                // Pobieranie danych dostawcy z kolumny I2 i zwrotu z J2 w arkuszu IDSklep
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
        console.error('Wystąpił błąd:', error);
        res.status(500).json({ error: 'Wystąpił błąd podczas logowania' });
    }
});

app.get('/sklepName', (req, res) => {
    res.json({ sklepName });
});

// Endpoint do wylogowania użytkownika
app.post('/logout', (req, res) => {
    try {
        // Resetowanie zmiennych globalnych
        IDSklep = '';
        sklepName = '';
        IDZapas = '';

        res.json({ success: true, message: 'Wylogowano pomyślnie' });
    } catch (error) {
        console.error('Błąd podczas wylogowywania:', error);
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas wylogowywania' });
    }
});

app.get('/search', async (req, res) => {
    try {
        const searchInput = req.query.searchInput.toLowerCase();  // Pobranie danych z wejścia użytkownika
        const data = await getSheetData(IDSklep, 'Kontrola zwrotu!A1:G');  // Pobierz wszystkie dane z zakresu A do G
        const returnPolicyData = await getSheetData(IDSklep, 'Kontrola zwrotu!J2:J2');  // Dane o polityce zwrotu

        // Nagłówki - wyciągamy kolumny A, B, C, D, E, F, G
        const headers = [data[0][0], data[0][1], data[0][2], data[0][4], data[0][3], data[0][5], data[0][6]];
        const filteredData = data.slice(1).map(row => [row[0], row[1], row[2], row[4], row[3], row[5]]);

        // Filtrujemy dane tylko w kolumnach A i B
        const matchingData = filteredData.filter(row => 
            (row[0] && row[0].toLowerCase() === searchInput) ||  // Sprawdzamy kolumnę A
            (row[1] && row[1].toLowerCase() === searchInput)     // Sprawdzamy kolumnę B
        );

        // Tworzymy odpowiedź zawierającą nagłówki, wyniki dopasowane i dane o polityce zwrotu
        const responseData = { 
            headers, 
            filteredData: matchingData, 
            returnValue: returnPolicyData[0][0] || 'Brak danych' 
        };

        // Wysyłamy odpowiedź do klienta
        res.json(responseData);
    } catch (error) {
        console.error('Wystąpił błąd:', error);
        res.status(500).json({ error: 'Wystąpił błąd podczas wyszukiwania danych' });
    }
});

// Nowy endpoint do obsługi żądania wyszukiwania z zapas.html
app.get('/searchZapas', async (req, res) => {
    try {
        const searchInput = req.query.searchInput.trim();
        const data = await getSheetData(IDZapas, 'Baza!A:D'); 

        const headers = [data[0][1],data[0][2], data[0][3]];
        const filteredData = data.slice(1).map(row => [row[1],row[2], row[3]]);

        // Dokładne filtrowanie danych
        const matchingData = filteredData.filter(row => 
            row.some(cell => cell && cell.toString() === searchInput)
        );

        const responseData = { 
            headers, 
            filteredData: matchingData
        };

        res.json(responseData);
    } catch (error) {
        console.error('Wystąpił błąd:', error);
        res.status(500).json({ error: 'Wystąpił błąd podczas wyszukiwania danych zapasu.' });
    }
});

// Nowy endpoint do aktualizacji ilości w Arkuszu2
app.post('/updateQuantity', async (req, res) => {
    try {
        const { searchInput, quantity } = req.body;
        const spreadsheetId = IDSklep;
        const range = 'Zamówienia suma!A:K';

        const sheetData = await getSheetData(spreadsheetId, range);

        // Znajdujemy indeks wiersza pasujący do searchInput
        const rowIndex = sheetData.findIndex(row => row[0] === searchInput || row[1] === searchInput);

        if (rowIndex === -1) {
            return res.json({ success: false, message: 'Nie znaleziono danych w Arkusz2.' });
        }

        // Pobranie istniejącej wartości z kolumny K i dodanie ilości
        const existingQuantity = parseFloat(sheetData[rowIndex][4]) || 0;
        const newQuantity = existingQuantity + quantity;

        // Aktualizacja danych w Google Sheets
        await google.sheets({ version: 'v4', auth: client }).spreadsheets.values.update({
            spreadsheetId,
            range: `Zamówienia suma!K${rowIndex + 1}`, // Określenie komórki w kolumnie F dla znalezionego wiersza
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newQuantity]] },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Błąd aktualizacji:', error);
        res.status(500).json({ success: false, error: 'Wystąpił błąd podczas aktualizacji ilości.' });
    }
});
// Endpoint do zapisu danych do Arkusza3
app.post('/saveToSheet', async (req, res) => {
    try {
        const { paletaNumber, rowData, quantity } = req.body;
        const spreadsheetId = IDZapas; // Arkusz zapasu, IDZapas odnosi się do arkusza głównego

        // Ustawienia zakresu dla kolumny A, aby znaleźć pierwszy pusty wiersz
        const rangeToCheck = 'Zapas!A:A';
        const gsapi = google.sheets({ version: 'v4', auth: client });
        const columnData = await gsapi.spreadsheets.values.get({
            spreadsheetId,
            range: rangeToCheck,
        });

        // Znalezienie pierwszego pustego wiersza
        const firstEmptyRow = columnData.data.values ? columnData.data.values.length + 1 : 1;

        // Dane do zapisania: paletaNumber, rowData i quantity
        const newRow = [paletaNumber, ...rowData, quantity];

        // Wstawienie danych w pierwszym pustym wierszu zaczynając od kolumny A
        await gsapi.spreadsheets.values.update({
            spreadsheetId,
            range: `Zapas!A${firstEmptyRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Błąd zapisu do Arkusza3:', error);
        res.status(500).json({ success: false, message: 'Wystąpił błąd podczas zapisu do Arkusza3.' });
    }
});
// Endpoint do pobierania wartości sklepName
app.get('/getShopName', (req, res) => {
    res.json({ shopName: sklepName });
});


// Uruchomienie serwera
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
