// Configure sua web app do Firebase aqui
const firebaseConfig = {
    apiKey: "AIzaSyCDu3dKi74AXs3_-KU7pkh_Dp4Y_Jkl29Y",
    authDomain: "split-pagamentos-api-v1.firebaseapp.com",
    projectId: "split-pagamentos-api-v1",
    storageBucket: "split-pagamentos-api-v1.firebasestorage.app",
    messagingSenderId: "76669154458",
    appId: "1:76669154458:web:f220d707155980df2a1b23"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
