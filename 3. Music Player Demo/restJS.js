async function GetData() {
    let endpoint = 'https://jsonplaceholder.typicode.com/users/';
    const request = await fetch(endpoint);
    const response = await request.json();
    console.log(response)
}

GetData() // call the function