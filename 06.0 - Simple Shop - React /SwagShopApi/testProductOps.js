const postProduct = async(data)=>{
    try{
        const response = await fetch('http://localhost:3000/product',{
            method:'POST',
            headers:{
                'Content-Type': 'application/json',
            },
            body:JSON.stringify(data),
        }
        );
        
        if(!response.ok){
            const errorMessage = await response.text();
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            console.error(`Response Body: ${errorMessage}`);
            throw new Error(`Request failed with status: ${response.status}`);
         }
            const responseData = await response.json();
            console.log(`Server response: ${JSON.stringify(responseData)}`);
    

    }
    catch(error){
        console.error("Error:", error.message);
    }
};
const getAllProducts = async()=>{
    try{
        const response = await fetch('http://localhost:3000/products',{
            method:'GET',
            headers:{
                'Content-Type': 'application/json',
            }
        })
        if(!response.ok){
            const errorMessage = await response.text();
            throw new Error(`Request failed with status: ${response.status}`);
        }
        const responseData = await response.json();
        //return JSON.stringify(responseData);
        console.log(`Server response: ${JSON.stringify(responseData)}`);

    }catch(error){
        console.error("Error:", error.message);
    }
};
const prodToAdd = {
    title : "Link's Shield",
    price : 193.99,
}
// postProduct(prodToAdd);
// getAllProducts().then((res)=>{
//     console.log(res);
// })
getAllProducts();