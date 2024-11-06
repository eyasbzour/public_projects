class HttpService{

   getProducts= async ()=>{
        try{
            const response = await fetch('http://localhost:3000/products');
            const data = await response.json();
            return data;
        }
        catch(err){
           return err;
        }
    }
    // getProducts= () =>{
    //     var promise = new Promise((resolve,reject)=>{
    //         fetch('http://localhost:3000/products')
    //         .then((response)=>{
    //             resolve(response.json());
    //         })
    //         .catch((err)=>{
    //             reject(err);
    //         })
    //     })
    //     return promise;
    // }
}
export default HttpService;